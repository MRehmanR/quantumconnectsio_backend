const { sequelize } = require('../config/db');
const { UsageCycle, User } = require('../models');

const PLAN_LIMITS = {
    Trial: { includedCalls: 50, concurrentCalls: 2 },
    Starter: { includedCalls: 75, concurrentCalls: 5 },
    Core: { includedCalls: 200, concurrentCalls: 10 },
    Pro: { includedCalls: 500, concurrentCalls: 20 },
    Scale: { includedCalls: 1200, concurrentCalls: 50 }
};

const getPlanLimits = (planName) => PLAN_LIMITS[planName] || PLAN_LIMITS.Core;

const getMonthlyAnniversaryWindow = (user, now = new Date()) => {
    const anchorDay = Number(user.billingAnniversaryDay || new Date(user.createdAt).getDate() || 1);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisCycleStart = new Date(monthStart);
    thisCycleStart.setDate(Math.min(anchorDay, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()));

    if (now < thisCycleStart) {
        thisCycleStart.setMonth(thisCycleStart.getMonth() - 1);
        thisCycleStart.setDate(Math.min(anchorDay, new Date(thisCycleStart.getFullYear(), thisCycleStart.getMonth() + 1, 0).getDate()));
    }

    const cycleEnd = new Date(thisCycleStart);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1);

    return { cycleStart: thisCycleStart, cycleEnd };
};

const ensureUsageCycleRow = async (user, transaction) => {
    const now = new Date();
    const { cycleStart, cycleEnd } = getMonthlyAnniversaryWindow(user, now);

    const existing = await UsageCycle.findOne({ where: { userId: user.id }, transaction });
    if (!existing) {
        return UsageCycle.create(
            {
                userId: user.id,
                cycleStart,
                cycleEnd,
                includedCallsUsed: 0,
                addonCallsBalance: 0,
                addonCallsUsed: 0,
                concurrentCallsActive: 0
            },
            { transaction }
        );
    }

    if (new Date(existing.cycleEnd) <= now) {
        existing.cycleStart = cycleStart;
        existing.cycleEnd = cycleEnd;
        existing.includedCallsUsed = 0;
        existing.addonCallsUsed = 0;
        existing.concurrentCallsActive = 0;
        existing.alert70SentAt = null;
        existing.alert100SentAt = null;
        await existing.save({ transaction });
    }

    return existing;
};

const preflightCall = async ({ tenantEmail, dialedNumber, idempotencyKey }) => {
    return sequelize.transaction(async (transaction) => {
        let user = null;

        if (dialedNumber) {
            user = await User.findOne({ where: { inboundNumber: dialedNumber }, transaction });
        }
        if (!user && tenantEmail) {
            user = await User.findOne({ where: { email: tenantEmail }, transaction });
        }

        if (!user) {
            return {
                accepted: false,
                action: 'reject',
                reason: 'tenant_not_found'
            };
        }

        if (user.status !== 'Active') {
            return {
                accepted: false,
                action: 'route_or_reject',
                reason: 'tenant_inactive',
                ownerPhone: user.ownerPhone || ''
            };
        }

        const limits = getPlanLimits(user.plan);
        const cycle = await ensureUsageCycleRow(user, transaction);

        const currentConcurrent = Number(cycle.concurrentCallsActive || 0);
        if (currentConcurrent >= limits.concurrentCalls) {
            return {
                accepted: false,
                action: 'queue',
                reason: 'concurrent_limit_exceeded',
                queueTargetSeconds: 10,
                currentConcurrent,
                concurrentLimit: limits.concurrentCalls
            };
        }

        const nextIncludedUsed = Number(cycle.includedCallsUsed || 0) + 1;
        const includedLimit = limits.includedCalls;
        const totalAllowance = includedLimit + Number(cycle.addonCallsBalance || 0);
        const totalUsedBefore = Number(cycle.includedCallsUsed || 0) + Number(cycle.addonCallsUsed || 0);
        const totalUsedAfter = totalUsedBefore + 1;

        let overLimit = false;
        if (nextIncludedUsed > includedLimit) {
            const addonAvailable = Number(cycle.addonCallsBalance || 0) - Number(cycle.addonCallsUsed || 0);
            if (addonAvailable > 0) {
                cycle.addonCallsUsed = Number(cycle.addonCallsUsed || 0) + 1;
            } else {
                overLimit = true;
            }
        } else {
            cycle.includedCallsUsed = nextIncludedUsed;
        }

        cycle.concurrentCallsActive = currentConcurrent + 1;
        await cycle.save({ transaction });

        user.callsUsed = Number(user.callsUsed || 0) + 1;
        await user.save({ transaction });

        const threshold70Reached = totalUsedAfter >= Math.ceil(includedLimit * 0.7);
        const threshold100Reached = totalUsedAfter >= includedLimit;

        return {
            accepted: !overLimit,
            action: overLimit ? 'route_owner' : 'allow_ai',
            reason: overLimit ? 'usage_limit_exceeded' : 'ok',
            ownerPhone: user.ownerPhone || '',
            userId: user.id,
            idempotencyKey: idempotencyKey || '',
            usage: {
                plan: user.plan,
                includedLimit,
                totalAllowance,
                used: totalUsedAfter,
                remaining: Math.max(totalAllowance - totalUsedAfter, 0),
                threshold70Reached,
                threshold100Reached,
                concurrentActive: Number(cycle.concurrentCallsActive || 0),
                concurrentLimit: limits.concurrentCalls
            }
        };
    });
};

const finalizeCall = async ({ tenantEmail, dialedNumber, wasConnected }) => {
    return sequelize.transaction(async (transaction) => {
        let user = null;

        if (dialedNumber) {
            user = await User.findOne({ where: { inboundNumber: dialedNumber }, transaction });
        }
        if (!user && tenantEmail) {
            user = await User.findOne({ where: { email: tenantEmail }, transaction });
        }
        if (!user) {
            return { success: false, reason: 'tenant_not_found' };
        }

        const cycle = await ensureUsageCycleRow(user, transaction);
        cycle.concurrentCallsActive = Math.max(Number(cycle.concurrentCallsActive || 0) - 1, 0);
        await cycle.save({ transaction });

        return {
            success: true,
            reason: 'ok',
            concurrentActive: Number(cycle.concurrentCallsActive || 0),
            connected: Boolean(wasConnected)
        };
    });
};

module.exports = {
    preflightCall,
    finalizeCall,
    PLAN_LIMITS,
    getPlanLimits
};
