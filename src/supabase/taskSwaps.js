import { supabase } from './config';

/**
 * Request a task swap with another user
 * @param {Object} params - Swap parameters
 * @param {string} params.taskId - The task ID
 * @param {string} params.requesterId - The user ID requesting the swap
 * @param {string} params.requestedId - The user ID being requested
 * @param {string} params.reason - Reason for the swap request
 * @param {string} params.dueDate - Task due date
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const requestTaskSwap = async ({ taskId, requesterId, requestedId, reason, dueDate }) => {
  try {
    // Create the swap request
    const { data, error } = await supabase
      .from('task_swap_requests')
      .insert([{
        task_id: taskId,
        requester_id: requesterId,
        requested_id: requestedId,
        reason,
        status: 'pending',
        due_date: dueDate
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    // Create notification for the requested user
    const { error: notifError } = await supabase
      .from('notifications')
      .insert([{
        user_id: requestedId,
        title: 'New Task Swap Request',
        message: 'Someone wants to swap tasks with you',
        type: 'task_swap',
        read: false,
        data: { swapId: data.id, taskId }
      }]);
    
    if (notifError) console.error('Error creating notification:', notifError);
    
    return { success: true, swapId: data.id };
  } catch (error) {
    console.error('Error requesting task swap:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Accept a task swap request
 * @param {string} swapId - The swap request ID
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const acceptTaskSwap = async (swapId) => {
  try {
    // Get the swap request details
    const { data: swap, error: swapError } = await supabase
      .from('task_swap_requests')
      .select('*')
      .eq('id', swapId)
      .single();
    
    if (swapError) throw swapError;
    
    // Update the swap request status
    const { error: updateError } = await supabase
      .from('task_swap_requests')
      .update({ status: 'accepted' })
      .eq('id', swapId);
    
    if (updateError) throw updateError;
    
    // Get the task details
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', swap.task_id)
      .single();
    
    if (taskError) throw taskError;
    
    // Update the task assignment
    const { error: reassignError } = await supabase
      .from('tasks')
      .update({ assigned_to: swap.requested_id })
      .eq('id', swap.task_id);
    
    if (reassignError) throw reassignError;
    
    // Record this swap in task history
    const { error: historyError } = await supabase
      .from('task_history')
      .insert([{
        task_id: swap.task_id,
        action: 'swap',
        from_user_id: swap.requester_id,
        to_user_id: swap.requested_id,
        note: swap.reason || 'Task swap',
        swap_id: swapId
      }]);
    
    if (historyError) console.error('Error creating task history entry:', historyError);
    
    // Update user task stats for both users
    // Update requester stats (add swap)
    const { error: requesterStatsError } = await supabase.rpc(
      'increment_user_stats',
      { 
        user_id: swap.requester_id, 
        group_id: task.group_id,
        swapped_count: 1
      }
    );
    
    if (requesterStatsError) console.error('Error updating requester stats:', requesterStatsError);
    
    // Create notification for the requester
    const { error: notifError } = await supabase
      .from('notifications')
      .insert([{
        user_id: swap.requester_id,
        title: 'Task Swap Accepted',
        message: 'Your task swap request was accepted',
        type: 'task_swap',
        read: false,
        data: { swapId, taskId: swap.task_id }
      }]);
    
    if (notifError) console.error('Error creating notification:', notifError);
    
    return { success: true };
  } catch (error) {
    console.error('Error accepting task swap:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Reject a task swap request
 * @param {string} swapId - The swap request ID
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const rejectTaskSwap = async (swapId) => {
  try {
    // Get the swap request details
    const { data: swap, error: swapError } = await supabase
      .from('task_swap_requests')
      .select('*')
      .eq('id', swapId)
      .single();
    
    if (swapError) throw swapError;
    
    // Update the swap request status
    const { error: updateError } = await supabase
      .from('task_swap_requests')
      .update({ status: 'rejected' })
      .eq('id', swapId);
    
    if (updateError) throw updateError;
    
    // Create notification for the requester
    const { error: notifError } = await supabase
      .from('notifications')
      .insert([{
        user_id: swap.requester_id,
        title: 'Task Swap Rejected',
        message: 'Your task swap request was rejected',
        type: 'task_swap',
        read: false,
        data: { swapId, taskId: swap.task_id }
      }]);
    
    if (notifError) console.error('Error creating notification:', notifError);
    
    return { success: true };
  } catch (error) {
    console.error('Error rejecting task swap:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get task swap history for a specific task
 * @param {string} taskId - The task ID
 * @returns {Promise<Object>} - Object containing success status, swap history, and any error
 */
export const getTaskSwapHistory = async (taskId) => {
  try {
    const { data, error } = await supabase
      .from('task_swap_requests')
      .select(`
        *,
        requester:profiles!requester_id(id, full_name, avatar_url),
        requested:profiles!requested_id(id, full_name, avatar_url)
      `)
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return { success: true, swaps: data || [] };
  } catch (error) {
    console.error('Error fetching task swap history:', error);
    return { success: false, error: error.message, swaps: [] };
  }
};
