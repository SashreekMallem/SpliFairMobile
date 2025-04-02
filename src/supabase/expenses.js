import { supabase } from './config';

// Get all expenses for a specific group
export const getExpenses = async (groupId) => {
  try {
    const { data, error } = await supabase
      .from('expenses')
      .select(`
        *,
        created_by:profiles(id, full_name, avatar_url),
        expense_shares:expense_shares(
          *,
          user:profiles(id, full_name, avatar_url)
        )
      `)
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return { success: true, expenses: data };
  } catch (error) {
    console.error('Error fetching expenses:', error.message);
    return { success: false, error: error.message };
  }
};

// Create a new expense
export const createExpense = async (expenseData, sharesData) => {
  try {
    // Start a transaction
    const { data, error } = await supabase.rpc('create_expense_with_shares', {
      expense_data: expenseData,
      shares_data: sharesData
    });

    if (error) throw error;
    return { success: true, expense: data };
  } catch (error) {
    console.error('Error creating expense:', error.message);
    return { success: false, error: error.message };
  }
};

// Update an expense
export const updateExpense = async (expenseId, updates) => {
  try {
    const { data, error } = await supabase
      .from('expenses')
      .update(updates)
      .eq('id', expenseId)
      .select();
    
    if (error) throw error;
    return { success: true, expense: data[0] };
  } catch (error) {
    console.error('Error updating expense:', error.message);
    return { success: false, error: error.message };
  }
};

// Delete an expense
export const deleteExpense = async (expenseId) => {
  try {
    // This will cascade delete related expense shares due to foreign key constraints
    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', expenseId);
    
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error deleting expense:', error.message);
    return { success: false, error: error.message };
  }
};

// Mark a share as paid
export const markShareAsPaid = async (shareId, isPaid = true) => {
  try {
    const { data, error } = await supabase
      .from('expense_shares')
      .update({ paid: isPaid, paid_at: isPaid ? new Date() : null })
      .eq('id', shareId)
      .select();
    
    if (error) throw error;
    return { success: true, share: data[0] };
  } catch (error) {
    console.error('Error updating payment status:', error.message);
    return { success: false, error: error.message };
  }
};

// Get expense summary for a group
export const getExpenseSummary = async (groupId) => {
  try {
    const { data, error } = await supabase.rpc('get_expense_summary', {
      group_id_param: groupId
    });
    
    if (error) throw error;
    return { success: true, summary: data };
  } catch (error) {
    console.error('Error fetching expense summary:', error.message);
    return { success: false, error: error.message };
  }
};

// Set up a real-time subscription to expenses
export const subscribeToExpenses = (groupId, callback) => {
  return supabase
    .channel('expenses-channel')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'expenses',
      filter: `group_id=eq.${groupId}`
    }, (payload) => {
      callback(payload);
    })
    .subscribe();
};

// Create a pending share for a non-registered user (by email)
export const createPendingShare = async (expenseId, email, amount) => {
  try {
    // Validate inputs
    if (!expenseId) return { success: false, error: 'Missing expense ID' };
    if (!email) return { success: false, error: 'Missing email' };
    if (!amount) return { success: false, error: 'Missing amount' };
    
    // Insert pending share
    const { data, error } = await supabase
      .from('pending_expense_shares')
      .insert({
        expense_id: expenseId,
        email: email,
        amount: parseFloat(amount),
        created_at: new Date().toISOString(),
        status: 'pending'
      })
      .select();
    
    if (error) throw error;
    
    return { success: true, pendingShare: data[0] };
  } catch (error) {
    console.error('Error creating pending share:', error.message);
    return { success: false, error: error.message };
  }
};

// Get pending shares for an expense
export const getPendingShares = async (expenseId) => {
  try {
    const { data, error } = await supabase
      .from('pending_expense_shares')
      .select('*')
      .eq('expense_id', expenseId);
    
    if (error) throw error;
    
    return { success: true, pendingShares: data };
  } catch (error) {
    console.error('Error getting pending shares:', error.message);
    return { success: false, error: error.message };
  }
};

// Get pending shares for an email
export const getPendingSharesByEmail = async (email) => {
  try {
    const { data, error } = await supabase
      .from('pending_expense_shares')
      .select(`
        *,
        expense:expenses(id, description, amount, date, category)
      `)
      .eq('email', email);
    
    if (error) throw error;
    
    return { success: true, pendingShares: data };
  } catch (error) {
    console.error('Error getting pending shares by email:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Record a settlement between users (simplified version)
 * @param {Object} settlementData - Settlement information
 * @returns {Promise<Object>} - Success status and any error
 */
export const recordSettlement = async (settlementData) => {
  try {
    // Find unpaid expense shares between these users
    const { data: fromUserShares, error: sharesError } = await supabase
      .from('expense_shares')
      .select(`
        id,
        amount,
        expense_id,
        user_id,
        paid
      `)
      .eq('user_id', settlementData.from_user_id)
      .eq('paid', false)
      .order('created_at', { ascending: true });
    
    if (sharesError) throw sharesError;
    
    // Mark shares as paid up to the settlement amount
    let remainingAmount = settlementData.amount;
    const paidShareIds = [];
    
    for (const share of fromUserShares || []) {
      if (remainingAmount <= 0) break;

      if (share.amount <= remainingAmount) {
        // Fully pay this share
        paidShareIds.push(share.id);
        remainingAmount -= share.amount;
      } else {
        // Partial payment: deduct from share, don't mark as fully paid
        // (You'd need a column to track partially paid amounts or split the share)
        const partialPaid = share.amount - remainingAmount;
        // Update share with the new remaining balance
        const { error: partialError } = await supabase
          .from('expense_shares')
          .update({
            amount: partialPaid, // The leftover after partial payment
            payment_method: settlementData.payment_method,
            settlement_note: settlementData.note
          })
          .eq('id', share.id);

        if (partialError) throw partialError;

        remainingAmount = 0;
      }
    }

    if (paidShareIds.length > 0) {
      // Mark fully covered shares as paid
      const { error: updateError } = await supabase
        .from('expense_shares')
        .update({
          paid: true,
          paid_at: new Date(),
          payment_method: settlementData.payment_method,
          settlement_note: settlementData.note
        })
        .in('id', paidShareIds);

      if (updateError) throw updateError;
    }
    
    // Create notifications
    const { error: notifError } = await supabase
      .from('notifications')
      .insert([
        {
          user_id: settlementData.from_user_id,
          type: 'payment',
          title: 'Payment Sent',
          message: `You sent $${settlementData.amount} to settle expenses`,
          data: { total_amount: settlementData.amount, shares_paid: paidShareIds.length }
        },
        {
          user_id: settlementData.to_user_id,
          type: 'payment',
          title: 'Payment Received',
          message: `You received $${settlementData.amount} settlement payment`,
          data: { total_amount: settlementData.amount, shares_paid: paidShareIds.length }
        }
      ]);
    
    // After paying shares, insert a record in expense_settlements
    const { data: settlementInsert, error: settlementError } = await supabase
      .from('expense_settlements')
      .insert({
        group_id: settlementData.group_id,
        from_user_id: settlementData.from_user_id,
        to_user_id: settlementData.to_user_id,
        amount: settlementData.amount,
        payment_method: settlementData.payment_method || 'cash',
        note: settlementData.note || '',
        status: 'completed',
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .single();

    if (settlementError) throw settlementError;

    return { success: true, paidShares: paidShareIds.length };
  } catch (error) {
    console.error('Error recording settlement:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get simplified/optimized debts for a group
 * @param {string} groupId - Group ID
 * @param {string} userId - Current user ID
 * @returns {Promise<Object>} - Success status and optimized settlements
 */
export const getSimplifiedDebts = async (groupId, userId) => {
  try {
    // Step 1: Get all debts in the group
    const { data: debts, error: debtsError } = await supabase.rpc('get_all_group_debts', {
      p_group_id: groupId
    });
    
    if (debtsError) throw debtsError;
    
    // If there are no debts, return empty array
    if (!debts || debts.length === 0) {
      return { success: true, settlements: [] };
    }
    
    // Step 2: Build a debt graph
    const debtGraph = {};
    const currencies = new Set();
    
    // Initialize debtGraph with all members
    debts.forEach(debt => {
      if (!debtGraph[debt.from_user_id]) {
        debtGraph[debt.from_user_id] = {};
      }
      if (!debtGraph[debt.to_user_id]) {
        debtGraph[debt.to_user_id] = {};
      }
      
      // Track all currencies used
      currencies.add(debt.currency);
    });
    
    // Calculate net debts - group by currency
    debts.forEach(debt => {
      const { from_user_id, to_user_id, amount, currency } = debt;
      
      if (!debtGraph[from_user_id][to_user_id]) {
        debtGraph[from_user_id][to_user_id] = {};
      }
      
      if (!debtGraph[to_user_id][from_user_id]) {
        debtGraph[to_user_id][from_user_id] = {};
      }
      
      if (!debtGraph[from_user_id][to_user_id][currency]) {
        debtGraph[from_user_id][to_user_id][currency] = 0;
      }
      
      if (!debtGraph[to_user_id][from_user_id][currency]) {
        debtGraph[to_user_id][from_user_id][currency] = 0;
      }
      
      // Add this debt to the graph
      debtGraph[from_user_id][to_user_id][currency] += amount;
      // Subtract from any reverse debt
      debtGraph[to_user_id][from_user_id][currency] -= amount;
    });
    
    // Step 3: Resolve bidirectional debts for each currency
    const netDebts = [];
    
    // Process each currency separately
    for (const currency of currencies) {
      for (const [fromUser, toUsers] of Object.entries(debtGraph)) {
        for (const [toUser, debts] of Object.entries(toUsers)) {
          const amount = debts[currency];
          
          // Only consider positive debts and avoid duplicates
          if (amount > 0 && fromUser < toUser) {
            // Calculate net amount between these two users in this currency
            const netAmount = Math.max(0, amount - (debtGraph[toUser]?.[fromUser]?.[currency] || 0));
            
            // Apply a minimum threshold (e.g., $0.01) to avoid tiny transactions
            if (netAmount >= 0.01) {
              // Determine the direction of the net debt
              let from = fromUser;
              let to = toUser;
              
              // If the reverse debt is bigger, flip direction
              if ((debtGraph[toUser]?.[fromUser]?.[currency] || 0) > amount) {
                from = toUser;
                to = fromUser;
              }
              
              netDebts.push({
                from_user_id: from,
                to_user_id: to,
                amount: Math.round(netAmount * 100) / 100, // Round to nearest cent
                currency
              });
            }
          }
        }
      }
    }
    
    // Step 4: Optimize the settlement graph (minimum-cash-flow algorithm)
    
    // Process each currency separately
    const optimizedSettlements = [];
    
    for (const currency of currencies) {
      // Calculate the net balance for each user in this currency
      const balances = {};
      netDebts.forEach(debt => {
        if (debt.currency !== currency) return;
        
        if (!balances[debt.from_user_id]) balances[debt.from_user_id] = 0;
        if (!balances[debt.to_user_id]) balances[debt.to_user_id] = 0;
        
        balances[debt.from_user_id] -= debt.amount;
        balances[debt.to_user_id] += debt.amount;
      });
      
      // Initialize arrays of creditors and debtors
      const creditors = [];
      const debtors = [];
      
      // Separate users into creditors and debtors based on their net balance
      for (const [userId, balance] of Object.entries(balances)) {
        // Use a small epsilon (0.01) to handle floating point errors
        if (balance > 0.01) {
          creditors.push({ id: userId, amount: balance });
        } else if (balance < -0.01) {
          debtors.push({ id: userId, amount: -balance });
        }
      }
      
      // Sort creditors and debtors by amount (descending)
      creditors.sort((a, b) => b.amount - a.amount);
      debtors.sort((a, b) => b.amount - a.amount);
      
      // Generate optimized settlements for this currency
      while (creditors.length > 0 && debtors.length > 0) {
        const creditor = creditors[0];
        const debtor = debtors[0];
        
        // Get the minimum of what debtor owes and what creditor is owed
        const amount = Math.min(creditor.amount, debtor.amount);
        
        // Round to nearest cent to avoid floating point issues
        const roundedAmount = Math.round(amount * 100) / 100;
        
        // Skip very small settlements (less than $0.01)
        if (roundedAmount < 0.01) {
          // Remove exhausted users
          if (Math.abs(creditor.amount - amount) < 0.01) creditors.shift();
          else creditors[0].amount -= amount;
          
          if (Math.abs(debtor.amount - amount) < 0.01) debtors.shift();
          else debtors[0].amount -= amount;
          
          continue;
        }
        
        // Remove the user who gets fully settled
        if (Math.abs(creditor.amount - amount) < 0.01) creditors.shift();
        else creditors[0].amount -= amount;
        
        if (Math.abs(debtor.amount - amount) < 0.01) debtors.shift();
        else debtors[0].amount -= amount;
        
        // Create a new optimized settlement
        optimizedSettlements.push({
          from_user_id: debtor.id,
          to_user_id: creditor.id,
          amount: roundedAmount,
          currency,
          optimized: true
        });
      }
    }
    
    // Step 5: Fetch user details for all involved users
    const userIds = new Set();
    [...netDebts, ...optimizedSettlements].forEach(debt => {
      userIds.add(debt.from_user_id);
      userIds.add(debt.to_user_id);
    });
    
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', Array.from(userIds));
    
    if (profilesError) throw profilesError;
    
    // Create a map for easy lookup
    const profilesMap = {};
    profiles?.forEach(profile => {
      profilesMap[profile.id] = {
        id: profile.id,
        name: profile.full_name,
        avatar: profile.avatar_url
      };
    });
    
    // Map original settlements before optimization (for reference)
    const originalSettlements = netDebts.map(debt => ({
      from: profilesMap[debt.from_user_id],
      to: profilesMap[debt.to_user_id],
      amount: debt.amount,
      currency: debt.currency,
      optimized: false
    }));
    
    // Map optimized settlements with replaced information
    const mappedOptimizedSettlements = optimizedSettlements.map(debt => {
      // Find which original settlements this optimized one replaces
      const replaced = netDebts.filter(origDebt => 
        (origDebt.from_user_id === debt.from_user_id && origDebt.to_user_id !== debt.to_user_id) ||
        (origDebt.to_user_id === debt.to_user_id && origDebt.from_user_id !== debt.from_user_id)
      ).map(origDebt => ({
        from: profilesMap[origDebt.from_user_id],
        to: profilesMap[origDebt.to_user_id],
        amount: origDebt.amount,
        currency: origDebt.currency
      }));
      
      return {
        from: profilesMap[debt.from_user_id],
        to: profilesMap[debt.to_user_id],
        amount: debt.amount,
        currency: debt.currency,
        optimized: true,
        replaced: replaced.length > 0 ? replaced : null
      };
    });
    
    // Return either original or optimized settlements based on whether optimization reduced transactions
    const hasOptimization = optimizedSettlements.length < netDebts.length;
    
    return { 
      success: true, 
      settlements: hasOptimization ? mappedOptimizedSettlements : originalSettlements,
      optimized: hasOptimization,
      stats: {
        originalCount: netDebts.length,
        optimizedCount: optimizedSettlements.length,
        reductionPercent: netDebts.length > 0 ? 
          Math.round((1 - optimizedSettlements.length / netDebts.length) * 100) : 0
      }
    };
  } catch (error) {
    console.error('Error calculating simplified debts:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get expense performance metrics for all members in a group
 * @param {string} groupId - The group ID
 * @returns {Promise<Object>} - Object containing success status and performance data
 */
export const getExpensePerformance = async (groupId) => {
  try {
    // Get all group members
    const { data: members, error: membersError } = await supabase
      .from('group_members')
      .select(`
        user_id,
        profile:profiles(id, full_name, avatar_url)
      `)
      .eq('group_id', groupId);
    
    if (membersError) throw membersError;
    
    if (!members || members.length === 0) {
      return { success: true, performance: [] };
    }
    
    // Calculate performance for each member
    const performance = await Promise.all(
      members.map(async (member) => {
        // Get all expenses created by this user for this group
        const { data: createdExpenses, error: expensesError } = await supabase
          .from('expenses')
          .select('id, amount, date')
          .eq('created_by', member.user_id)
          .eq('group_id', groupId);
        
        if (expensesError) throw expensesError;
        
        // Get all expense shares assigned to this user
        const { data: assignedShares, error: sharesError } = await supabase
          .from('expense_shares')
          .select(`
            id, amount, paid, paid_at, created_at,
            expense:expenses(id, date, created_at)
          `)
          .eq('user_id', member.user_id)
          .not('expense', 'is', null);
        
        if (sharesError) throw sharesError;
        
        // Calculate performance metrics
        const totalShares = assignedShares?.length || 0;
        const paidShares = assignedShares?.filter(s => s.paid).length || 0;
        const unpaidShares = totalShares - paidShares;
        
        // Calculate payment promptness (days from creation to payment)
        let totalPaymentDays = 0;
        let promptPayments = 0;
        
        assignedShares?.forEach(share => {
          if (share.paid && share.paid_at && share.expense?.created_at) {
            const createdDate = new Date(share.expense.created_at);
            const paidDate = new Date(share.paid_at);
            const daysToPay = Math.round((paidDate - createdDate) / (1000 * 60 * 60 * 24));
            
            totalPaymentDays += daysToPay;
            
            // Count payments made within 3 days as prompt
            if (daysToPay <= 3) {
              promptPayments++;
            }
          }
        });
        
        const avgPaymentTime = paidShares > 0 ? (totalPaymentDays / paidShares) : 0;
        const promptnessRate = paidShares > 0 ? (promptPayments / paidShares) * 100 : 0;
        
        // Calculate expense contribution stats
        const contributedExpenses = createdExpenses?.length || 0;
        const totalContributedAmount = createdExpenses?.reduce((sum, exp) => sum + Number(exp.amount), 0) || 0;
        
        // Calculate settlements - use expense_shares instead of expense_settlements
        const { data: paidSharesData, error: paidSharesError } = await supabase
          .from('expense_shares')
          .select('id, amount, paid_at')
          .eq('user_id', member.user_id)
          .eq('paid', true)
          .not('paid_at', 'is', null);
        
        if (paidSharesError) throw paidSharesError;
        
        // Count how many payments were made in the last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const recentPayments = paidSharesData?.filter(share => 
          new Date(share.paid_at) > thirtyDaysAgo
        ).length || 0;
        
        // Calculate comprehensive metrics
        const metrics = {
          totalShares,
          paidShares,
          unpaidShares,
          paymentRate: totalShares > 0 ? (paidShares / totalShares) * 100 : 100,
          promptnessRate,
          avgPaymentTime,
          contributedExpenses,
          totalContributedAmount,
          initiatedSettlements: recentPayments,
          receivedSettlements: 0, // We don't track this separately
          lastPaymentDate: paidSharesData?.sort((a, b) => 
            new Date(b.paid_at) - new Date(a.paid_at)
          )[0]?.paid_at || null
        };
        
        // Calculate overall score
        const score = calculateExpenseScore(metrics);
        
        return {
          userId: member.user_id,
          name: member.profile?.full_name || 'Unknown',
          avatar_url: member.profile?.avatar_url,
          metrics,
          score
        };
      })
    );
    
    // Sort by score (highest first)
    performance.sort((a, b) => b.score - a.score);
    
    return { success: true, performance };
  } catch (error) {
    console.error('Error calculating expense performance:', error);
    return { success: false, error: error.message, performance: [] };
  }
};

/**
 * Calculate expense performance score
 * @param {Object} metrics - Performance metrics
 * @returns {number} - Performance score (0-100)
 */
const calculateExpenseScore = (metrics) => {
  // Handle empty case
  if (metrics.totalShares === 0 && metrics.contributedExpenses === 0) {
    return 50; // Neutral score
  }
  
  // PAYMENT RESPONSIBILITY - 50% weight
  // Higher payment rate and promptness = better score
  const paymentRateScore = Math.min(100, metrics.paymentRate);
  const promptnessScore = Math.min(100, metrics.promptnessRate);
  const paymentResponsibilityScore = (paymentRateScore * 0.7) + (promptnessScore * 0.3);
  
  // CONTRIBUTION FAIRNESS - 30% weight
  // More balanced contribution of expenses = better score
  let contributionScore = 50; // Default neutral score
  
  // We don't have enough context to calculate true fairness
  // Assuming regular contribution is good
  if (metrics.contributedExpenses > 0) {
    contributionScore = Math.min(100, 50 + (metrics.contributedExpenses * 10));
  }
  
  // SETTLEMENT BEHAVIOR - 20% weight  
  // Initiating settlements when you owe = better score
  let settlementScore = 50; // Default neutral score
  
  if (metrics.initiatedSettlements > 0) {
    settlementScore = Math.min(100, 70 + (metrics.initiatedSettlements * 5));
  }
  
  // Calculate final score with weights
  const finalScore = (paymentResponsibilityScore * 0.5) +
                     (contributionScore * 0.3) +
                     (settlementScore * 0.2);
  
  // Ensure score is between 0-100
  return Math.round(Math.max(0, Math.min(100, finalScore)));
};

/**
 * Get analytics data for a group
 * @param {string} groupId - The group ID
 * @param {string} userId - The current user ID
 * @param {Object} options - Options for filtering (timeRange, etc.)
 * @returns {Promise<Object>} - Object containing success status and analytics data
 */
export const getExpenseAnalytics = async (groupId, userId, options = {}) => {
  try {
    if (!groupId) throw new Error('Group ID is required');
    
    // Default to last 30 days if not specified
    const timeRange = options.timeRange || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeRange);
    
    // Get expenses for the time range
    const { data: expenses, error: expensesError } = await supabase
      .from('expenses')
      .select(`
        *,
        created_by:profiles(id, full_name, avatar_url)
      `)
      .eq('group_id', groupId)
      .gte('date', startDate.toISOString().split('T')[0]);
    
    if (expensesError) throw expensesError;
    
    // If no expenses, return empty analytics
    if (!expenses || expenses.length === 0) {
      return { 
        success: true,
        analytics: {
          totalSpent: 0,
          categorySummary: [],
          monthlyTrend: [],
          userShares: [],
          recentExpenses: []
        }
      };
    }
    
    // Calculate total spent
    const totalSpent = expenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
    
    // Calculate category breakdown
    const categoryMap = {};
    expenses.forEach(expense => {
      const category = expense.category || 'Other';
      if (!categoryMap[category]) {
        categoryMap[category] = 0;
      }
      categoryMap[category] += parseFloat(expense.amount);
    });
    
    const categorySummary = Object.entries(categoryMap).map(([name, total]) => ({
      name,
      total,
      percentage: Math.round((total / totalSpent) * 100)
    })).sort((a, b) => b.total - a.total);
    
    // Calculate monthly trend
    const months = {};
    expenses.forEach(expense => {
      const date = new Date(expense.date);
      const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      
      if (!months[monthKey]) {
        months[monthKey] = { month: monthKey, total: 0 };
      }
      months[monthKey].total += parseFloat(expense.amount);
    });
    
    const monthlyTrend = Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
    
    // Calculate individual shares
    const { data: expenseShares, error: sharesError } = await supabase
      .from('expense_shares')
      .select(`
        amount, paid,
        expense:expenses(id, group_id),
        user:profiles(id, full_name, avatar_url)
      `)
      .eq('expense.group_id', groupId);
    
    if (sharesError) throw sharesError;
    
    // Group by user
    const userShareMap = {};
    expenseShares?.forEach(share => {
      if (!share.user || !share.user.id) return;
      
      const userId = share.user.id;
      if (!userShareMap[userId]) {
        userShareMap[userId] = {
          userId,
          name: share.user.full_name,
          avatar: share.user.avatar_url,
          totalOwed: 0,
          totalPaid: 0
        };
      }
      
      const amount = parseFloat(share.amount);
      if (share.paid) {
        userShareMap[userId].totalPaid += amount;
      } else {
        userShareMap[userId].totalOwed += amount;
      }
    });
    
    const userShares = Object.values(userShareMap);
    
    // Get recent expenses
    const recentExpenses = expenses
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5)
      .map(expense => ({
        id: expense.id,
        description: expense.description,
        amount: expense.amount,
        date: expense.date,
        category: expense.category || 'Other'
      }));
    
    return {
      success: true,
      analytics: {
        totalSpent,
        categorySummary,
        monthlyTrend,
        userShares,
        recentExpenses
      }
    };
  } catch (error) {
    console.error('Error getting expense analytics:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get reminder settings for a user in a group
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @returns {Promise<Object>} - Object containing success status and settings
 */
export const getReminderSettings = async (userId, groupId) => {
  try {
    const { data, error } = await supabase
      .from('expense_reminder_settings')
      .select('*')
      .eq('user_id', userId)
      .eq('group_id', groupId)
      .single();
    
    if (error && error.code !== 'PGSQL_ERROR') throw error;
    
    // If no settings found, return default settings
    if (!data) {
      return { 
        success: true, 
        settings: {
          autoReminders: false,
          frequency: 'weekly',
          daysBefore: 3,
          customMessage: 'Hey! Just a friendly reminder about the expense payment due soon.',
          emailNotifications: true,
          appNotifications: true
        }
      };
    }
    
    return { success: true, settings: data };
  } catch (error) {
    console.error('Error fetching reminder settings:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Update reminder settings for a user in a group
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @param {Object} settings - The settings to update
 * @returns {Promise<Object>} - Object containing success status
 */
export const updateReminderSettings = async (userId, groupId, settings) => {
  try {
    // Check if settings already exist
    const { data: existingSettings, error: checkError } = await supabase
      .from('expense_reminder_settings')
      .select('id')
      .eq('user_id', userId)
      .eq('group_id', groupId)
      .single();
    
    if (checkError && checkError.code !== 'PGSQL_ERROR') throw checkError;
    
    // Insert or update based on whether settings exist
    if (existingSettings) {
      const { error } = await supabase
        .from('expense_reminder_settings')
        .update(settings)
        .eq('id', existingSettings.id);
      
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('expense_reminder_settings')
        .insert([{
          user_id: userId,
          group_id: groupId,
          ...settings
        }]);
      
      if (error) throw error;
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error updating reminder settings:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get pending payment reminders for a group
 * @param {string} groupId - The group ID
 * @returns {Promise<Object>} - Object containing success status and reminders
 */
export const getPendingReminders = async (groupId) => {
  try {
    // Get all unpaid expense shares with due dates
    const { data: expenses, error: expensesError } = await supabase
      .from('expenses')
      .select(`
        id, 
        description, 
        amount, 
        date,
        group_id,
        expense_shares:expense_shares(
          id, 
          amount, 
          paid,
          user:profiles!user_id(id, full_name, avatar_url)
        )
      `)
      .eq('group_id', groupId)
      .order('date', { ascending: false });
    
    if (expensesError) throw expensesError;
    
    // Filter to find unpaid shares and format as reminders
    const now = new Date();
    const reminders = [];
    
    expenses?.forEach(expense => {
      if (!expense.expense_shares) return;
      
      const dueDate = new Date(expense.date);
      const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
      
      // Add a reminder for each unpaid share
      expense.expense_shares.forEach(share => {
        if (!share.paid && share.user) {
          reminders.push({
            id: `${expense.id}_${share.id}`,
            expense_id: expense.id,
            share_id: share.id,
            recipient_id: share.user.id,
            recipient_name: share.user.full_name,
            recipient_avatar: share.user.avatar_url,
            amount: share.amount,
            due_date: expense.date,
            days_overdue: Math.max(0, daysOverdue),
            status: 'pending',
            expense: {
              description: expense.description,
              amount: expense.amount
            }
          });
        }
      });
    });
    
    return { success: true, reminders };
  } catch (error) {
    console.error('Error fetching pending reminders:', error);
    return { success: false, error: error.message, reminders: [] };
  }
};

/**
 * Send a payment reminder
 * @param {string} reminderId - The composite reminder ID (expense_id_share_id)
 * @returns {Promise<Object>} - Object containing success status
 */
export const sendReminder = async (reminderId) => {
  try {
    const [expenseId, shareId] = reminderId.split('_');
    
    // Get share details
    const { data: share, error: shareError } = await supabase
      .from('expense_shares')
      .select(`
        id, 
        user_id,
        expense:expenses!expense_id(
          id, description, amount, date
        )
      `)
      .eq('id', shareId)
      .single();
    
    if (shareError) throw shareError;
    
    // Send notification
    const { error: notifError } = await supabase
      .from('notifications')
      .insert([{
        user_id: share.user_id,
        type: 'payment_reminder',
        title: 'Payment Reminder',
        message: `You have an outstanding payment for ${share.expense.description}`,
        read: false,
        data: {
          expense_id: share.expense.id,
          amount: share.expense.amount,
          due_date: share.expense.date
        }
      }]);
    
    if (notifError) throw notifError;
    
    // Log the reminder
    const { error: logError } = await supabase
      .from('expense_reminder_logs')
      .insert([{
        expense_id: expenseId,
        share_id: shareId,
        recipient_id: share.user_id,
        sent_at: new Date().toISOString(),
        status: 'sent'
      }]);
    
    if (logError) console.error('Error logging reminder:', logError);
    
    return { success: true };
  } catch (error) {
    console.error('Error sending reminder:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Schedule automatic reminders based on settings
 * @param {string} groupId - The group ID
 * @param {Object} settings - Reminder settings
 * @returns {Promise<Object>} - Object containing success status
 */
export const scheduleAutomaticReminders = async (groupId, settings) => {
  try {
    // This would normally queue reminders in a job system, but for this demo
    // we'll just log that automatic reminders have been scheduled
    console.log('Scheduled automatic reminders for group:', groupId, 'with settings:', settings);
    
    // In a real implementation, this would interact with a backend job scheduler
    // or serverless function that runs on a schedule
    
    return { success: true };
  } catch (error) {
    console.error('Error scheduling automatic reminders:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get user transaction history
 * @param {string} userId - User ID to fetch transactions for
 * @param {string} period - Time period ('month', '3months', 'year', 'all')
 * @param {string} type - Transaction type filter ('all', 'expense', 'income')
 * @returns {Promise<Object>} - Success status, transactions data and any error
 */
export const getUserTransactions = async (userId, period = 'month', type = 'all') => {
  try {
    if (!userId) {
      return { success: false, error: 'User ID is required' };
    }

    // Calculate the date range based on period
    const endDate = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case '3months':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case 'all':
      default:
        startDate = new Date(0); // Beginning of time
        break;
    }

    // First get expenses where user is the creator
    const { data: createdExpenses, error: createdError } = await supabase
      .from('expenses')
      .select(`
        id,
        description,
        amount,
        date,
        created_at,
        category,
        created_by (id, full_name, avatar_url),
        expense_shares (
          id,
          user_id,
          amount,
          paid,
          user:profiles!expense_shares_user_id_fkey (id, full_name)
        )
      `)
      .eq('created_by', userId)
      .gte('date', startDate.toISOString().split('T')[0]);

    if (createdError) {
      console.error('Error fetching created expenses:', createdError);
      return { success: false, error: createdError.message };
    }

    // Then get expenses where user has a share
    const { data: sharedExpenses, error: sharedError } = await supabase
      .from('expense_shares')
      .select(`
        id,
        user_id,
        amount,
        paid,
        expense:expenses (
          id,
          description,
          amount,
          date,
          created_at,
          category,
          created_by (id, full_name, avatar_url)
        )
      `)
      .eq('user_id', userId)
      .gte('expense.date', startDate.toISOString().split('T')[0])
      .not('expense', 'is', null);

    if (sharedError) {
      console.error('Error fetching shared expenses:', sharedError);
      return { success: false, error: sharedError.message };
    }

    // Get sent settlements with a manual join to profiles instead of using foreign key relationship
    const { data: sentSettlements, error: sentError } = await supabase
      .from('expense_settlements')
      .select(`
        id, 
        amount, 
        created_at, 
        payment_method,
        status,
        note,
        from_user_id,
        to_user_id
      `)
      .eq('from_user_id', userId)
      .gte('created_at', startDate.toISOString());

    if (sentError) {
      console.error('Error fetching sent settlements:', sentError);
      return { success: false, error: sentError.message };
    }

    // Get received settlements
    const { data: receivedSettlements, error: receivedError } = await supabase
      .from('expense_settlements')
      .select(`
        id, 
        amount, 
        created_at, 
        payment_method,
        status,
        note,
        from_user_id,
        to_user_id
      `)
      .eq('to_user_id', userId)
      .gte('created_at', startDate.toISOString());

    if (receivedError) {
      console.error('Error fetching received settlements:', receivedError);
      return { success: false, error: receivedError.message };
    }

    // Fetch profiles for settlement users if needed
    let profilesMap = {};
    if ((sentSettlements && sentSettlements.length > 0) || 
        (receivedSettlements && receivedSettlements.length > 0)) {
      
      // Collect all user IDs that need profile info
      const userIds = new Set();
      
      sentSettlements?.forEach(s => {
        if (s.to_user_id && s.to_user_id !== userId) userIds.add(s.to_user_id);
      });
      
      receivedSettlements?.forEach(s => {
        if (s.from_user_id && s.from_user_id !== userId) userIds.add(s.from_user_id);
      });
      
      if (userIds.size > 0) {
        // Fetch profiles for all users in a single query
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', Array.from(userIds));
        
        // Create a map for easy lookup
        if (profiles) {
          profilesMap = profiles.reduce((map, profile) => {
            map[profile.id] = profile;
            return map;
          }, {});
        }
      }
    }

    // Process expenses where user is creator
    const processedCreatedExpenses = (createdExpenses || []).map(expense => {
      // Expense creator is always the user (income from others or paid by self)
      const hasOtherParticipants = expense.expense_shares?.some(share => share.user_id !== userId);
      const type = hasOtherParticipants ? 'income' : 'expense';
      
      // Determine recipient
      let recipientName = 'Other users';
      if (expense.expense_shares?.length === 1) {
        recipientName = expense.expense_shares[0]?.user?.full_name || 'Other user';
      }
      
      return {
        id: expense.id,
        description: expense.description,
        amount: expense.amount,
        date: expense.date,
        created_at: expense.created_at,
        status: 'completed', // Creator has paid by definition
        type,
        participant_name: 'You',
        recipient_name: recipientName,
        category: expense.category
      };
    });

    // Process expenses where user has a share
    const processedSharedExpenses = (sharedExpenses || [])
      .filter(share => share.expense) // Ensure expense exists
      .map(share => {
        return {
          id: share.expense.id,
          description: share.expense.description,
          amount: share.amount, // Use the share amount, not the full expense amount
          date: share.expense.date,
          created_at: share.expense.created_at,
          status: share.paid ? 'completed' : 'pending', // Derive status from paid flag
          type: 'expense', // User owes someone else
          participant_name: share.expense.created_by?.full_name || 'Unknown',
          recipient_name: 'You',
          category: share.expense.category
        };
      });

    // Process sent settlements (user paid others) - using profilesMap instead of direct joins
    const processedSentSettlements = (sentSettlements || []).map(settlement => {
      const toUserProfile = profilesMap[settlement.to_user_id] || {};
      
      return {
        id: `s-${settlement.id}`,
        description: settlement.note || 'Settlement payment sent',
        amount: settlement.amount,
        created_at: settlement.created_at,
        date: new Date(settlement.created_at).toISOString().split('T')[0],
        status: settlement.status || 'completed',
        type: 'expense', // User sent money
        participant_name: 'You',
        recipient_name: toUserProfile.full_name || 'Unknown recipient',
        payment_method: settlement.payment_method
      };
    });

    // Process received settlements (user received money) - using profilesMap instead of direct joins
    const processedReceivedSettlements = (receivedSettlements || []).map(settlement => {
      const fromUserProfile = profilesMap[settlement.from_user_id] || {};
      
      return {
        id: `s-${settlement.id}`,
        description: settlement.note || 'Settlement payment received',
        amount: settlement.amount,
        created_at: settlement.created_at,
        date: new Date(settlement.created_at).toISOString().split('T')[0],
        status: settlement.status || 'completed',
        type: 'income', // User received money
        participant_name: fromUserProfile.full_name || 'Unknown sender',
        recipient_name: 'You',
        payment_method: settlement.payment_method
      };
    });

    // Combine all transactions
    let allTransactions = [
      ...processedCreatedExpenses,
      ...processedSharedExpenses,
      ...processedSentSettlements,
      ...processedReceivedSettlements
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Force received settlements to be positive (income), paid to be negative (expense)
    allTransactions = allTransactions.map(t => {
      const sign = t.type === 'income' ? 1 : -1;
      return { ...t, amount: sign * parseFloat(t.amount) };
    });

    // Apply type filter if specified
    if (type !== 'all') {
      allTransactions = allTransactions.filter(t => t.type === type);
    }

    return {
      success: true,
      transactions: allTransactions
    };
  } catch (error) {
    console.error('Error in getUserTransactions:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to fetch transaction history'
    };
  }
};

/**
 * Get currency exchange rates
 * @returns {Promise<Object>} - Success status and exchange rates
 */
export const getCurrencyRates = async () => {
  try {
    // In a real app, you would fetch from an API like Open Exchange Rates or ECB
    // For this demo, we'll use a mock implementation with static rates
    
    // Check if we have cached rates and they're not too old (1 hour)
    const cachedRates = localStorage.getItem('currencyRates');
    const cachedTimestamp = localStorage.getItem('currencyRatesTimestamp');
    
    if (cachedRates && cachedTimestamp && (Date.now() - parseInt(cachedTimestamp)) < 3600000) {
      return { 
        success: true, 
        rates: JSON.parse(cachedRates),
        cached: true 
      };
    }
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Mock rates relative to USD
    const rates = {
      USD: 1,
      EUR: 0.92,
      GBP: 0.78,
      JPY: 145.23,
      CAD: 1.35,
      AUD: 1.48,
      CNY: 7.21,
      INR: 83.15,
      MXN: 17.05,
      BRL: 4.92
    };
    
    // Cache the rates
    localStorage.setItem('currencyRates', JSON.stringify(rates));
    localStorage.setItem('currencyRatesTimestamp', Date.now().toString());
    
    return { success: true, rates };
  } catch (error) {
    console.error('Error fetching currency rates:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Convert amount between currencies
 * @param {number} amount - Amount to convert
 * @param {string} fromCurrency - Source currency code
 * @param {string} toCurrency - Target currency code
 * @returns {Promise<Object>} - Success status and converted amount
 */
export const convertCurrency = async (amount, fromCurrency, toCurrency) => {
  try {
    if (!amount || fromCurrency === toCurrency) {
      return { success: true, convertedAmount: amount };
    }
    
    const { success, rates } = await getCurrencyRates();
    
    if (!success) {
      throw new Error('Failed to get currency rates');
    }
    
    if (!rates[fromCurrency] || !rates[toCurrency]) {
      throw new Error('Invalid currency code');
    }
    
    // Convert through base currency (USD in our case)
    const convertedAmount = (amount * rates[toCurrency]) / rates[fromCurrency];
    
    return { success: true, convertedAmount };
  } catch (error) {
    console.error('Error converting currency:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get friends of a user for direct expenses
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Success status and friends list
 */
export const getFriends = async (userId) => {
  try {
    // Get users who have been in groups together with this user
    const { data, error } = await supabase.rpc('get_user_friends', {
      p_user_id: userId
    });
    
    if (error) throw error;
    
    return { success: true, friends: data || [] };
  } catch (error) {
    console.error('Error fetching friends:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Create an expense directly with a friend (no group)
 * @param {Object} expenseData - Expense data
 * @param {string} expenseData.created_by - User who created the expense
 * @param {string} expenseData.friend_id - Friend's user ID
 * @param {string} expenseData.description - Expense description
 * @param {number} expenseData.amount - Expense amount
 * @param {string} expenseData.date - Expense date
 * @param {string} expenseData.category - Expense category
 * @param {string} expenseData.split_method - Split method (equal, percentage, etc.)
 * @param {string} expenseData.currency - Currency code
 * @param {number} expenseData.exchangeRate - Exchange rate to default currency
 * @returns {Promise<Object>} - Success status and created expense
 */
export const createFriendExpense = async (expenseData) => {
  try {
    // Validate that we have both users
    if (!expenseData.created_by || !expenseData.friend_id) {
      throw new Error('Both users are required for friend expense');
    }
    
    // Insert expense record
    const { data: expense, error: expenseError } = await supabase
      .from('expenses')
      .insert({
        description: expenseData.description,
        amount: expenseData.amount,
        date: expenseData.date || new Date().toISOString().slice(0, 10),
        category: expenseData.category || 'Other',
        created_by: expenseData.created_by,
        split_method: expenseData.split_method || 'equal',
        recurring: expenseData.recurring || false,
        frequency: expenseData.frequency,
        currency: expenseData.currency || 'USD',
        exchange_rate: expenseData.exchangeRate || 1.0,
        friend_expense: true // Mark as friend expense
      })
      .select()
      .single();
    
    if (expenseError) throw expenseError;
    
    // Calculate share amount based on split method
    let userShare, friendShare;
    
    switch (expenseData.split_method) {
      case 'equal':
        userShare = friendShare = expenseData.amount / 2;
        break;
      case 'percentage':
        const userPercentage = expenseData.userPercentage || 50;
        userShare = (expenseData.amount * userPercentage) / 100;
        friendShare = expenseData.amount - userShare;
        break;
      case 'fixed':
      case 'custom':
        userShare = expenseData.userAmount || (expenseData.amount / 2);
        friendShare = expenseData.amount - userShare;
        break;
      default:
        userShare = friendShare = expenseData.amount / 2;
    }
    
    // Insert shares for both users
    const { data: shares, error: sharesError } = await supabase
      .from('expense_shares')
      .insert([
        {
          expense_id: expense.id,
          user_id: expenseData.created_by,
          amount: userShare,
          paid: expenseData.paidBy === expenseData.created_by
        },
        {
          expense_id: expense.id,
          user_id: expenseData.friend_id,
          amount: friendShare,
          paid: expenseData.paidBy === expenseData.friend_id
        }
      ])
      .select();
    
    if (sharesError) throw sharesError;
    
    // Create friendship record if it doesn't exist
    const { error: friendshipError } = await supabase
      .from('friendships')
      .upsert([
        {
          user_id_1: expenseData.created_by < expenseData.friend_id ? expenseData.created_by : expenseData.friend_id,
          user_id_2: expenseData.created_by < expenseData.friend_id ? expenseData.friend_id : expenseData.created_by,
          status: 'active'
        }
      ], { onConflict: 'user_id_1, user_id_2' });
    
    if (friendshipError) {
      console.warn('Error upserting friendship:', friendshipError);
      // Non-critical error, continue
    }
    
    return { 
      success: true, 
      expense: {
        ...expense,
        expense_shares: shares
      }
    };
  } catch (error) {
    console.error('Error creating friend expense:', error);
    return { success: false, error: error.message };
  }
};
