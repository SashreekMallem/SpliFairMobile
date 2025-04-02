import { supabase } from './config';

/**
 * Fetch tasks based on various filters
 * @param {Object} filters - Filters like groupId, assigneeId, dueDate, etc.
 * @returns {Promise<Object>} - Object containing success status, tasks array, and any error
 */
export const getTasks = async (filters = {}) => {
  try {
    let query = supabase
      .from('tasks')
      .select(`
        *,
        assigned_to_profile:profiles!tasks_assigned_to_fkey(id, full_name, avatar_url)
      `);
    
    // Apply filters
    if (filters.groupId) {
      query = query.eq('group_id', filters.groupId);
    }
    
    if (filters.dueDate) {
      query = query.eq('due_date', filters.dueDate);
    }
    
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    
    // Execute query
    const { data: tasks, error } = await query.order('due_date', { ascending: true });
    
    if (error) throw error;
    
    // Transform to a more convenient format for frontend use
    const formattedTasks = tasks.map(task => {
      return {
        id: task.id,
        title: task.title,
        description: task.description,
        dueDate: task.due_date,
        assignedTo: task.assigned_to,
        assignedBy: task.assigned_by,
        status: task.status,
        completedAt: task.completed_at,
        createdAt: task.created_at,
        groupId: task.group_id,
        assigneeName: task.assigned_to_profile?.full_name,
        assigneeAvatar: task.assigned_to_profile?.avatar_url,
        // UI expects these fields
        currentAssignee: task.assigned_to,
        completed: task.status === 'completed'
      };
    });
    
    // If assignee filter is provided, filter client-side
    let filteredTasks = formattedTasks;
    if (filters.assigneeId) {
      filteredTasks = formattedTasks.filter(task => 
        task.assignedTo === filters.assigneeId
      );
    }
    
    return { success: true, tasks: filteredTasks };
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return { success: false, error: error.message, tasks: [] };
  }
};

/**
 * Create a new task
 * @param {Object} taskData - The task data
 * @returns {Promise<Object>} - Object containing success status, created task, and any error
 */
export const createTask = async (taskData) => {
  try {
    // Extract any extra metadata we want to store
    const { priority, frequency, ...coreTaskData } = taskData;
    
    // Create the task with proper schema fields
    const { data: task, error } = await supabase
      .from('tasks')
      .insert([coreTaskData])
      .select()
      .single();
    
    if (error) throw error;
    
    // Store metadata like priority/frequency if needed
    // This could be in a separate table or added as custom fields
    
    return { 
      success: true, 
      task: {
        ...task,
        priority,
        frequency,
        currentAssignee: task.assigned_to
      }
    };
  } catch (error) {
    console.error('Error creating task:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Update an existing task
 * @param {number} taskId - The task ID to update
 * @param {Object} taskData - The updated task data
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const updateTask = async (taskId, taskData) => {
  try {
    // Extract any metadata we're handling separately
    const { priority, frequency, ...coreTaskData } = taskData;
    
    // Update the main task with schema-aligned fields
    const { error } = await supabase
      .from('tasks')
      .update(coreTaskData)
      .eq('id', taskId);
    
    if (error) throw error;
    
    // Update metadata if needed
    
    return { success: true };
  } catch (error) {
    console.error('Error updating task:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Mark a task as complete
 * @param {number} taskId - The task ID
 * @param {string} userId - The user ID marking it complete
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const markTaskComplete = async (taskId, userId) => {
  try {
    // First get the task to check due date
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('due_date, assigned_to, group_id, status')
      .eq('id', taskId)
      .single();
    
    if (taskError) throw taskError;
    
    // Only proceed if task wasn't already completed
    if (task.status === 'completed') {
      return { success: true, alreadyCompleted: true };
    }
    
    // Check if the user marking complete is the assigned user
    if (task.assigned_to !== userId) {
      return { 
        success: false, 
        error: 'Only the assigned user can mark this task as complete' 
      };
    }
    
    const now = new Date();
    const dueDate = new Date(task.due_date);
    const completedOnTime = now <= dueDate;
    
    // Update the task status
    const { error: updateError } = await supabase
      .from('tasks')
      .update({ 
        status: 'completed',
        completed_at: now.toISOString()
      })
      .eq('id', taskId);
    
    if (updateError) throw updateError;
    
    // Record the completion in task_completions
    const { error: completionError } = await supabase
      .from('task_completions')
      .insert([{
        task_id: taskId,
        user_id: userId,
        completed_at: now.toISOString(),
        scheduled_date: task.due_date,
        completed_on_time: completedOnTime
      }]);
    
    if (completionError) throw completionError;
    
    // Update user stats
    try {
      await supabase.rpc('increment_user_stats', { 
        user_id_param: userId, 
        group_id_param: task.group_id,
        completed_count: 1
      });
    } catch (statsError) {
      console.error('Error updating user stats:', statsError);
      // Continue even if stats update fails
    }
    
    return { success: true, completedOnTime };
  } catch (error) {
    console.error('Error marking task complete:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete a task
 * @param {number} taskId - The task ID to delete
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const deleteTask = async (taskId) => {
  try {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting task:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Rotate task assignment to the next person
 * @param {number} taskId - The task ID
 * @returns {Promise<Object>} - Object containing success status and next assignee
 */
export const rotateTaskAssignment = async (taskId) => {
  try {
    // Get current assignments sorted by rotation order
    const { data: assignments, error: assignmentsError } = await supabase
      .from('task_assignments')
      .select('*')
      .eq('task_id', taskId)
      .order('rotation_order', { ascending: true });
    
    if (assignmentsError) throw assignmentsError;
    
    if (!assignments || assignments.length < 2) {
      return { success: false, error: 'Not enough assignees for rotation' };
    }
    
    // Find the current assignee
    const currentIndex = assignments.findIndex(a => a.is_current);
    if (currentIndex === -1) {
      return { success: false, error: 'No current assignee found' };
    }
    
    // Calculate the next assignee index (wrapping around)
    const nextIndex = (currentIndex + 1) % assignments.length;
    
    // Update the assignments
    const currentAssignmentId = assignments[currentIndex].id;
    const nextAssignmentId = assignments[nextIndex].id;
    
    // Update current assignee (set is_current to false)
    const { error: updateCurrentError } = await supabase
      .from('task_assignments')
      .update({ is_current: false })
      .eq('id', currentAssignmentId);
    
    if (updateCurrentError) throw updateCurrentError;
    
    // Update next assignee (set is_current to true)
    const { error: updateNextError } = await supabase
      .from('task_assignments')
      .update({ is_current: true })
      .eq('id', nextAssignmentId);
    
    if (updateNextError) throw updateNextError;
    
    // Return the next assignee's user ID
    return { 
      success: true, 
      nextAssignee: assignments[nextIndex].user_id 
    };
  } catch (error) {
    console.error('Error rotating task assignment:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get task completion statistics
 * @param {number} taskId - The task ID
 * @returns {Promise<Object>} - Object containing success status and completion stats
 */
export const getTaskCompletionStats = async (taskId) => {
  try {
    // Get all completions for this task
    const { data: completions, error } = await supabase
      .from('task_completions')
      .select('*')
      .eq('task_id', taskId);
    
    if (error) throw error;
    
    if (!completions || completions.length === 0) {
      return { 
        success: true, 
        stats: {
          totalCompletions: 0,
          onTimeCompletions: 0,
          completionRate: 0,
          onTimeRate: 0
        }
      };
    }
    
    const totalCompletions = completions.length;
    const onTimeCompletions = completions.filter(c => c.completed_on_time).length;
    
    // Calculate per-user stats
    const userStats = {};
    completions.forEach(completion => {
      if (!userStats[completion.user_id]) {
        userStats[completion.user_id] = {
          total: 0,
          onTime: 0
        };
      }
      
      userStats[completion.user_id].total++;
      if (completion.completed_on_time) {
        userStats[completion.user_id].onTime++;
      }
    });
    
    // Overall completion rate (just using the raw data)
    // In a real implementation, this would consider expected completions based on frequency
    const completionRate = (totalCompletions / (totalCompletions + 0)) * 100;
    const onTimeRate = (onTimeCompletions / totalCompletions) * 100;
    
    return { 
      success: true, 
      stats: {
        totalCompletions,
        onTimeCompletions,
        completionRate,
        onTimeRate,
        userStats
      }
    };
  } catch (error) {
    console.error('Error getting task completion stats:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get user task statistics
 * @param {string} userId - The user ID
 * @param {string} groupId - The group ID
 * @returns {Promise<Object>} - Object containing success status and stats
 */
export const getUserTaskStats = async (userId, groupId) => {
  try {
    // First check if stats exist
    const { data, error } = await supabase
      .from('user_task_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('group_id', groupId)
      .maybeSingle();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    if (data) {
      return { 
        success: true, 
        stats: {
          total: data.total_tasks || 0,
          completed: data.completed_tasks || 0,
          missed: data.missed_tasks || 0,
          swapped: data.swapped_tasks || 0
        }
      };
    }
    
    // If no stats exist, calculate them
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('id, status')
      .eq('assigned_to', userId)
      .eq('group_id', groupId);
      
    if (tasksError) throw tasksError;
    
    const totalTasks = tasks?.length || 0;
    const completedTasks = tasks?.filter(t => t.status === 'completed').length || 0;
    const missedTasks = tasks?.filter(t => t.status === 'missed').length || 0;
    
    // Get swap count
    const { data: swaps, error: swapsError } = await supabase
      .from('task_swap_requests')
      .select('id')
      .eq('requester_id', userId)
      .eq('status', 'accepted');
      
    const swappedTasks = !swapsError ? swaps?.length || 0 : 0;
    
    // Create stats record
    const { error: createError } = await supabase
      .from('user_task_stats')
      .insert({
        user_id: userId,
        group_id: groupId,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        missed_tasks: missedTasks,
        swapped_tasks: swappedTasks
      });
      
    if (createError) throw createError;
    
    return { 
      success: true, 
      stats: {
        total: totalTasks,
        completed: completedTasks,
        missed: missedTasks,
        swapped: swappedTasks
      }
    };
  } catch (error) {
    console.error('Error getting user task stats:', error);
    return { 
      success: false, 
      error: error.message,
      stats: { total: 0, completed: 0, missed: 0, swapped: 0 }
    };
  }
};
