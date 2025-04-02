import { supabase } from './config';

/**
 * Search for a user by email or username
 * @param {string} query - Email or username to search for
 * @returns {Promise<Object>} - Success status and found user data
 */
export const searchUser = async (query) => {
  try {
    if (!query || query.trim() === '') {
      return { success: false, error: 'Search query cannot be empty' };
    }
    
    const normalizedQuery = query.trim().toLowerCase();
    const isEmail = normalizedQuery.includes('@');
    
    let searchQuery;
    
    if (isEmail) {
      // For emails - case-insensitive match
      searchQuery = supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .ilike('email', normalizedQuery)
        .limit(5);
    } else {
      // For names - partial match on full_name only
      searchQuery = supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .ilike('full_name', `%${normalizedQuery}%`)
        .limit(5);
    }
    
    const { data, error } = await searchQuery;
    
    if (error) throw error;
    
    if (!data || data.length === 0) {
      console.log(`No users found for query: ${normalizedQuery}`);
      return { success: false, message: 'No users found' };
    }
    
    console.log(`User found: ${data[0].full_name} (${data[0].email})`);
    return { success: true, user: data[0] };
  } catch (error) {
    console.error('Error searching for user:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Invite a user to the SpliFair app
 * @param {string} email - Email address to send invitation to
 * @param {string} inviterId - User ID of the person sending the invitation
 * @returns {Promise<Object>} - Success status of invitation
 */
export const inviteUserToSplitFair = async (email, inviterId) => {
  try {
    if (!email || !email.includes('@')) {
      return { success: false, error: 'Invalid email address' };
    }
    
    if (!inviterId) {
      return { success: false, error: 'Inviter ID is required' };
    }
    
    // We'll use the existing createGroupInvitation function, but with null group ID
    // to indicate this is an app-level invitation rather than group-specific
    const { createGroupInvitation } = await import('./groups');
    
    const { success, error } = await createGroupInvitation(
      null, // No specific group
      email.toLowerCase().trim(),
      inviterId,
      true // Flag as app invitation
    );
    
    if (!success) {
      throw new Error(error || 'Failed to send invitation');
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error inviting user to SpliFair:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Add a user as a friend
 * @param {string} userId - Current user's ID
 * @param {string} friendId - User ID to add as a friend
 * @returns {Promise<Object>} - Success status and friend data
 */
export const addFriend = async (userId, friendId) => {
  try {
    // Validation
    if (!userId || !friendId) {
      return { success: false, error: 'Both user IDs are required' };
    }
    
    if (userId === friendId) {
      return { success: false, error: 'Cannot add yourself as a friend' };
    }
    
    // Check if friendship already exists - using simpler filter approach
    // Check first direction (userId -> friendId)
    const { data: connection1, error: checkError1 } = await supabase
      .from('user_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('connected_user_id', friendId)
      .limit(1);
      
    if (checkError1) throw checkError1;
    
    // Check second direction (friendId -> userId)
    const { data: connection2, error: checkError2 } = await supabase
      .from('user_connections')
      .select('id')
      .eq('user_id', friendId)
      .eq('connected_user_id', userId)
      .limit(1);
      
    if (checkError2) throw checkError2;
    
    // If either direction has a connection, it exists
    if ((connection1 && connection1.length > 0) || (connection2 && connection2.length > 0)) {
      return { success: false, error: 'Friend connection already exists' };
    }
    
    // Get friend user details
    const { data: friendData, error: friendError } = await supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .eq('id', friendId)
      .single();
      
    if (friendError) throw friendError;
    
    if (!friendData) {
      return { success: false, error: 'Friend user not found' };
    }
    
    // Create bidirectional friend connections
    const connections = [
      { user_id: userId, connected_user_id: friendId, relationship_type: 'friend' },
      { user_id: friendId, connected_user_id: userId, relationship_type: 'friend' }
    ];
    
    const { error: insertError } = await supabase
      .from('user_connections')
      .insert(connections);
      
    if (insertError) throw insertError;
    
    return { 
      success: true, 
      friend: {
        id: friendData.id,
        name: friendData.full_name,
        email: friendData.email,
        avatar_url: friendData.avatar_url
      } 
    };
  } catch (error) {
    console.error('Error adding friend:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Get all friends for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Success status and list of friends
 */
export const getUserFriends = async (userId) => {
  try {
    if (!userId) {
      return { success: false, error: 'User ID is required' };
    }
    
    // Get all user connections where the user is connected as a friend
    const { data: connections, error: connectionError } = await supabase
      .from('user_connections')
      .select('connected_user_id')
      .eq('user_id', userId)
      .eq('relationship_type', 'friend');
    
    if (connectionError) throw connectionError;
    
    if (!connections || connections.length === 0) {
      // No friends found
      console.log('No friends found for user:', userId);
      return { success: true, friends: [] };
    }
    
    // Extract the friend user IDs
    const friendIds = connections.map(conn => conn.connected_user_id);
    
    // Fetch the profile information for these friend IDs
    const { data: friendProfiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .in('id', friendIds);
    
    if (profileError) throw profileError;
    
    // Format the response
    const friends = friendProfiles.map(profile => ({
      id: profile.id,
      name: profile.full_name,
      email: profile.email,
      avatar_url: profile.avatar_url
    }));
    
    console.log(`Found ${friends.length} friends for user ${userId}`);
    return { success: true, friends };
  } catch (error) {
    console.error('Error getting user friends:', error.message);
    return { success: false, error: error.message, friends: [] };
  }
};
