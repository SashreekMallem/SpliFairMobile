import { supabase } from './config';

/**
 * Report an issue with a completed task
 * @param {Object} issueData - The issue data
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const reportTaskIssue = async (issueData) => {
  try {
    const { data, error } = await supabase
      .from('task_issues')
      .insert([issueData])
      .select()
      .single();
    
    if (error) throw error;
    
    // Create notification for the assignee
    const { error: notifError } = await supabase
      .from('notifications')
      .insert([{
        user_id: issueData.assignee_id,
        title: 'Task Issue Reported',
        message: `Someone reported an issue with your task: ${issueData.description.substring(0, 50)}${issueData.description.length > 50 ? '...' : ''}`,
        type: 'task_issue',
        read: false,
        data: { 
          issue_id: data.id,
          task_id: issueData.task_id,
          issue_type: issueData.issue_type
        }
      }]);
    
    if (notifError) console.error('Error creating notification:', notifError);
    
    return { success: true, issue: data };
  } catch (error) {
    console.error('Error reporting task issue:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get issues reported for a specific task
 * @param {string} taskId - The task ID
 * @returns {Promise<Object>} - Object containing success status and issues
 */
export const getTaskIssues = async (taskId) => {
  try {
    const { data, error } = await supabase
      .from('task_issues')
      .select(`
        *,
        reporter:profiles!reported_by(id, full_name, avatar_url),
        assignee:profiles!assignee_id(id, full_name, avatar_url)
      `)
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return { success: true, issues: data || [] };
  } catch (error) {
    console.error('Error fetching task issues:', error);
    return { success: false, error: error.message, issues: [] };
  }
};

/**
 * Get issues assigned to a specific user
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Object containing success status and issues
 */
export const getUserTaskIssues = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('task_issues')
      .select(`
        *,
        reporter:profiles!reported_by(id, full_name, avatar_url),
        task:tasks(id, title, description, due_date)
      `)
      .eq('assignee_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return { success: true, issues: data || [] };
  } catch (error) {
    console.error('Error fetching user task issues:', error);
    return { success: false, error: error.message, issues: [] };
  }
};

/**
 * Update the status of a task issue
 * @param {string} issueId - The issue ID
 * @param {string} status - The new status ('pending', 'verified', 'rejected', 'resolved')
 * @param {string} note - Optional resolution note
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const updateTaskIssueStatus = async (issueId, status, note = null) => {
  try {
    const updateData = {
      status,
      updated_at: new Date().toISOString()
    };
    
    if (status === 'resolved' || note) {
      updateData.resolution_note = note;
      updateData.resolved_at = new Date().toISOString();
    }
    
    const { data, error } = await supabase
      .from('task_issues')
      .update(updateData)
      .eq('id', issueId)
      .select()
      .single();
    
    if (error) throw error;
    
    // Create notification for the reporter
    const { error: notifError } = await supabase
      .from('notifications')
      .insert([{
        user_id: data.reported_by,
        title: `Task Issue ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        message: `Your reported issue has been ${status}${note ? `: ${note.substring(0, 50)}${note.length > 50 ? '...' : ''}` : ''}`,
        type: 'task_issue',
        read: false,
        data: { 
          issue_id: issueId,
          task_id: data.task_id,
          status
        }
      }]);
    
    if (notifError) console.error('Error creating notification:', notifError);
    
    return { success: true, issue: data };
  } catch (error) {
    console.error('Error updating task issue status:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get task performance stats for all roommates in a group
 * @param {string} groupId - The group ID
 * @returns {Promise<Object>} - Object containing success status and performance data
 */
export const getRoommateTaskPerformance = async (groupId) => {
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
    
    // Get task stats for each member with comprehensive data
    const performance = await Promise.all(
      members.map(async (member) => {
        // Get all tasks assigned to this user for this group
        const { data: userTasks, error: tasksError } = await supabase
          .from('tasks')
          .select('id, status, due_date, completed_at')
          .eq('assigned_to', member.user_id)
          .eq('group_id', groupId);
        
        if (tasksError) throw tasksError;
        
        const totalTasks = userTasks?.length || 0;
        const completedTasks = userTasks?.filter(t => t.status === 'completed').length || 0;
        const missedTasks = userTasks?.filter(t => t.status === 'missed').length || 0;
        
        // Get verified issues count (tasks marked as having problems)
        const { count: issuesCount, error: issuesError } = await supabase
          .from('task_issues')
          .select('id', { count: 'exact', head: true })
          .eq('assignee_id', member.user_id)
          .eq('status', 'verified');
        
        if (issuesError) throw issuesError;
        
        // Get task swap counts (both initiated and received)
        const { data: swapsInitiated, error: swapsInitiatedError } = await supabase
          .from('task_swap_requests')
          .select('id, status')
          .eq('requester_id', member.user_id);
        
        if (swapsInitiatedError) throw swapsInitiatedError;
        
        const { data: swapsReceived, error: swapsReceivedError } = await supabase
          .from('task_swap_requests')
          .select('id, status')
          .eq('requested_id', member.user_id)
          .eq('status', 'accepted');
        
        if (swapsReceivedError) throw swapsReceivedError;
        
        // Calculate swap metrics
        const initiatedCount = swapsInitiated?.length || 0;
        const initiatedAccepted = swapsInitiated?.filter(s => s.status === 'accepted').length || 0;
        const initiatedRejected = swapsInitiated?.filter(s => s.status === 'rejected').length || 0;
        const receivedAccepted = swapsReceived?.length || 0;
        
        // Get task completion details (on time vs. late)
        const { data: completions, error: completionsError } = await supabase
          .from('task_completions')
          .select('completed_on_time, completed_at')
          .eq('user_id', member.user_id);
        
        if (completionsError) throw completionsError;
        
        const totalCompletions = completions?.length || 0;
        const onTimeCompletions = completions?.filter(c => c.completed_on_time).length || 0;
        const onTimePercentage = totalCompletions > 0 ? 
          Math.round((onTimeCompletions / totalCompletions) * 100) : 100;
        
        // Get stats from user_task_stats if exists (might be more accurate)
        const { data: statsRecord, error: statsError } = await supabase
          .from('user_task_stats')
          .select('*')
          .eq('user_id', member.user_id)
          .eq('group_id', groupId)
          .maybeSingle();
        
        // We prefer the stats record if it exists, otherwise use our calculated values
        const stats = statsRecord || {
          total_tasks: totalTasks,
          completed_tasks: completedTasks,
          missed_tasks: missedTasks,
          swapped_tasks: initiatedAccepted
        };
        
        // Create a detailed metrics object for complex scoring
        const metrics = {
          total: stats.total_tasks,
          completed: stats.completed_tasks,
          missed: stats.missed_tasks,
          swapped: stats.swapped_tasks,
          issues: issuesCount || 0,
          onTimePercentage,
          initiatedSwaps: initiatedCount,
          receivedSwaps: receivedAccepted,
          swapAcceptRate: initiatedCount > 0 ? 
            (initiatedAccepted / initiatedCount) * 100 : 100,
          // Helpfulness - higher when accepting swaps
          helpfulness: totalTasks > 0 ? 
            (receivedAccepted / Math.max(1, totalTasks/4)) * 100 : 50
        };
        
        // Calculate score using comprehensive algorithm
        const score = calculatePerformanceScore(metrics);
        
        return {
          userId: member.user_id,
          name: member.profile?.full_name || 'Unknown',
          avatar_url: member.profile?.avatar_url,
          stats: stats,
          issues: issuesCount || 0,
          onTimePercentage,
          metrics, // Include detailed metrics for transparency
          score
        };
      })
    );
    
    // Sort by score (highest first)
    performance.sort((a, b) => b.score - a.score);
    
    return { success: true, performance };
  } catch (error) {
    console.error('Error fetching roommate task performance:', error);
    return { success: false, error: error.message, performance: [] };
  }
};

/**
 * Calculate performance score based on comprehensive metrics
 * @param {Object} metrics - Performance metrics
 * @param {number} metrics.total - Total tasks assigned
 * @param {number} metrics.completed - Completed tasks
 * @param {number} metrics.missed - Missed tasks
 * @param {number} metrics.swapped - Swapped tasks
 * @param {number} metrics.issues - Verified quality issues
 * @param {number} metrics.onTimePercentage - % of on-time completions
 * @param {number} metrics.helpfulness - Measure of helping others
 * @returns {number} - Performance score (0-100)
 */
const calculatePerformanceScore = (metrics) => {
  // If person has had no tasks assigned, use a neutral score
  if (!metrics.total) return 50;
  
  // POSITIVE FACTORS
  
  // Completion rate: 40% of score
  // Higher when more tasks are completed successfully
  const completionRatio = metrics.total > 0 ? 
    Math.max(0, metrics.completed - metrics.issues) / metrics.total : 0;
  const completionScore = completionRatio * 100;
  
  // On-time performance: 25% of score
  // Higher when tasks are completed by their due dates
  const onTimeScore = metrics.onTimePercentage;
  
  // Helpfulness score: 15% of score
  // Higher when person accepts task swaps from others
  const helpfulnessScore = metrics.helpfulness;
  
  // NEGATIVE FACTORS
  
  // Miss penalty: 10% deduction at maximum
  // More missed tasks = bigger deduction
  const missRatio = metrics.total > 0 ? metrics.missed / metrics.total : 0;
  const missPenalty = missRatio * 100;
  
  // Issue penalty: 10% deduction at maximum
  // More quality issues = bigger deduction
  const issueRatio = metrics.completed > 0 ? metrics.issues / metrics.completed : 0;
  const issuePenalty = issueRatio * 100;
  
  // Excessive swap penalty: Up to 5% deduction
  // Penalizes constantly trying to swap out of tasks
  const excessiveSwapRatio = metrics.total > 0 ? 
    Math.max(0, (metrics.swapped / metrics.total) - 0.2) : 0; // Allow 20% swaps before penalty
  const swapPenalty = excessiveSwapRatio * 50; // 50% weight = max 5% impact
  
  // Calculate final score with appropriate weighting
  const score = (
    (completionScore * 0.40) +    // 40% weight to completion
    (onTimeScore * 0.25) +        // 25% weight to on-time performance
    (helpfulnessScore * 0.15) -   // 15% weight to helpfulness
    (missPenalty * 0.10) -        // 10% weight to missed tasks
    (issuePenalty * 0.10) -       // 10% weight to quality issues
    (swapPenalty * 0.05)          // 5% weight to excessive swapping
  );
  
  // Ensure score is between 0 and 100
  return Math.max(0, Math.min(100, Math.round(score)));
};
