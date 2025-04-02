import { supabase } from './config';

/**
 * Get notifications for a user
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Object containing success status and notifications
 */
export const getNotifications = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (error) throw error;
    
    return { success: true, notifications: data || [] };
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return { success: false, error: error.message, notifications: [] };
  }
};

/**
 * Mark a notification as read
 * @param {string} notificationId - The notification ID
 * @returns {Promise<Object>} - Object containing success status
 */
export const markNotificationAsRead = async (notificationId) => {
  try {
    if (!notificationId) {
      throw new Error('Notification ID is required');
    }
    
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Mark all notifications as read for a user
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Object containing success status
 */
export const markAllNotificationsAsRead = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Subscribe to real-time notifications for a user
 * @param {string} userId - The user ID
 * @param {Function} callback - Function to call when new notifications arrive
 * @returns {Object} - Supabase subscription
 */
export const subscribeToNotifications = (userId, callback) => {
  return supabase
    .channel('notifications-channel')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`
    }, (payload) => {
      callback(payload);
    })
    .subscribe();
};
