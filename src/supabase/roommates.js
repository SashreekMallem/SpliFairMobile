import { supabase } from './config';
import { createOrUpdateHomeGroup } from './groups';

// Get all roommates for the current user
export const getRoommates = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    // Fetch groups the user belongs to
    const { data: userGroups, error: groupsError } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId);
    
    if (groupsError) throw groupsError;
    
    if (!userGroups || userGroups.length === 0) {
      return { success: true, roommates: [] };
    }
    
    // Get the group IDs
    const groupIds = userGroups.map(group => group.group_id);
    
    // Find all members in the same groups (roommates)
    const { data: roommateMembers, error: membersError } = await supabase
      .from('group_members')
      .select(`
        user_id,
        role,
        group_id,
        joined_at
      `)
      .in('group_id', groupIds)
      .neq('user_id', userId); // Exclude the current user
    
    if (membersError) throw membersError;
    
    if (!roommateMembers || roommateMembers.length === 0) {
      return { success: true, roommates: [] };
    }
    
    // Get unique user IDs
    const uniqueRoommateIds = [...new Set(roommateMembers.map(member => member.user_id))];
    
    // Fetch roommate profiles
    const { data: profilesData, error: profilesError } = await supabase
      .from('profiles')
      .select('*')
      .in('id', uniqueRoommateIds);
    
    if (profilesError) throw profilesError;
    
    // Combine data with group information
    const roommates = profilesData.map(profile => {
      const memberData = roommateMembers.find(member => member.user_id === profile.id);
      return {
        ...profile,
        role: memberData?.role || 'member',
        group_id: memberData?.group_id,
        joined_at: memberData?.joined_at
      };
    });
    
    // Calculate score for each roommate
    const roomatesWithScores = await Promise.all(
      roommates.map(async roommate => {
        const score = await calculateRoommateScore(roommate.id, userId);
        return {
          ...roommate,
          paymentScore: score.score,
          outstandingAmount: score.outstandingAmount || 0,
          status: 'active' // Default status, can be updated with actual status
        };
      })
    );
    
    return { success: true, roommates: roomatesWithScores };
  } catch (error) {
    console.error('Error fetching roommates:', error);
    return { success: false, error: error.message };
  }
};

// Calculate roommate score based on payment history, task completion, etc.
export const calculateRoommateScore = async (roommateId, userId) => {
  try {
    // Initialize score components
    let paymentScore = 0;
    let responseScore = 0;
    let taskScore = 0;
    let outstandingAmount = 0;
    let totalComponents = 0;
    
    // 1. Check payment history
    const { data: payments, error: paymentsError } = await supabase
      .from('expense_shares')
      .select('*')
      .eq('user_id', roommateId)
      .order('created_at', { ascending: false })
      .limit(10); // Last 10 payments
    
    if (!paymentsError && payments && payments.length > 0) {
      // Calculate payment on-time ratio
      const onTimePayments = payments.filter(p => p.paid && new Date(p.paid_at) <= new Date(p.due_date)).length;
      const paymentRatio = payments.length > 0 ? onTimePayments / payments.length : 0;
      paymentScore = Math.round(paymentRatio * 100);
      totalComponents++;
      
      // Calculate outstanding amount
      const unpaidShares = payments.filter(p => !p.paid);
      outstandingAmount = unpaidShares.reduce((sum, share) => sum + share.amount, 0);
    } else {
      // Default payment score if no history
      paymentScore = 85; // Decent default score
    }
    
    // 2. Check task completion (if we have a tasks table)
    try {
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('assigned_to', roommateId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(10);
      
      if (!tasksError && tasks && tasks.length > 0) {
        // Calculate on-time task completion
        const { data: allTasks } = await supabase
          .from('tasks')
          .select('count')
          .eq('assigned_to', roommateId);
          
        const totalTasks = allTasks?.count || tasks.length;
        const taskRatio = totalTasks > 0 ? tasks.length / totalTasks : 0;
        taskScore = Math.round(taskRatio * 100);
        totalComponents++;
      }
    } catch (err) {
      // Tasks table might not exist, ignore error
      console.log('Tasks table might not exist, skipping task score');
    }
    
    // 3. Check response time to requests (if we track this)
    // This is a placeholder - implement actual logic if you track response times
    responseScore = 90; // Default good response score
    totalComponents++;
    
    // Calculate final score (weighted average of components)
    const finalScore = totalComponents > 0 
      ? Math.round((paymentScore + taskScore + responseScore) / totalComponents)
      : 85; // Default score if no components
    
    return { 
      score: finalScore,
      outstandingAmount: outstandingAmount,
      paymentScore: paymentScore,
      taskScore: taskScore,
      responseScore: responseScore
    };
  } catch (error) {
    console.error('Error calculating roommate score:', error);
    return { score: 85, outstandingAmount: 0 }; // Default fallback
  }
};

// Get the user's own roommate score
export const getUserScore = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    // Initialize score components with reasonable defaults
    let score = {
      score: 85,
      paymentScore: 85,
      taskScore: 85,
      responseScore: 90,
      outstandingAmount: 0
    };
    
    // 1. Check payment history (what the user has paid)
    const { data: paymentsMade, error: paymentsMadeError } = await supabase
      .from('expense_shares')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (!paymentsMadeError && paymentsMade && paymentsMade.length > 0) {
      // Calculate payment on-time ratio
      const onTimePayments = paymentsMade.filter(p => p.paid && new Date(p.paid_at) <= new Date(p.due_date)).length;
      const totalPayments = paymentsMade.length;
      const paymentRatio = totalPayments > 0 ? onTimePayments / totalPayments : 0;
      score.paymentScore = Math.round(paymentRatio * 100);
    }
    
    // 2. Check tasks assigned to the user
    try {
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('assigned_to', userId)
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (!tasksError && tasks && tasks.length > 0) {
        // Calculate task completion rate
        const completedTasks = tasks.filter(t => t.status === 'completed').length;
        const taskRatio = tasks.length > 0 ? completedTasks / tasks.length : 0;
        score.taskScore = Math.round(taskRatio * 100);
      }
    } catch (err) {
      // Tasks table might not exist, use default value
      console.log('Tasks table might not exist, using default task score');
    }
    
    // 3. Calculate overall score (weighted average)
    // Payment history has higher weight (50%) than the other factors
    score.score = Math.round(
      (score.paymentScore * 0.5) + 
      (score.taskScore * 0.3) + 
      (score.responseScore * 0.2)
    );
    
    return { 
      success: true,
      ...score
    };
  } catch (error) {
    console.error('Error calculating user score:', error);
    return { 
      success: false, 
      error: error.message,
      score: 85,
      paymentScore: 85,
      taskScore: 85,
      responseScore: 90
    };
  }
};

// Enhanced roommate invitation with user detection
export const inviteRoommate = async (groupId, email, invitedBy, homeDetails = null) => {
  try {
    if (!groupId || !email || !invitedBy) {
      throw new Error('Missing required parameters for invitation');
    }
    
    // Check if the user already exists
    const { data: existingUser, error: userError } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    
    if (userError) throw userError;
    
    // Get group name for the invitation
    const { data: groupData, error: groupError } = await supabase
      .from('groups')
      .select('name')
      .eq('id', groupId)
      .single();
    
    if (groupError) throw groupError;
    
    // Get inviter's information
    const { data: inviterData, error: inviterError } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', invitedBy)
      .single();
    
    if (inviterError) throw inviterError;
    
    // Generate a unique token for the invitation
    const token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    
    // Create the base invitation
    const invitationData = {
      group_id: groupId,
      email: email.toLowerCase(),
      invited_by: invitedBy,
      status: 'pending',
      token: token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      home_details: homeDetails
    };
    
    if (existingUser) {
      // User exists - create invitation and in-app notification
      const { data: invitation, error: inviteError } = await supabase
        .from('group_invitations')
        .insert(invitationData)
        .select()
        .single();
      
      if (inviteError) throw inviteError;
      
      // Create in-app notification
      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          user_id: existingUser.id,
          type: 'invitation',
          title: 'New Roommate Invitation',
          message: `${inviterData.full_name} invited you to join "${groupData.name}" as a roommate`,
          data: { 
            invitation_id: invitation.id,
            group_id: groupId,
            group_name: groupData.name,
            inviter_name: inviterData.full_name,
            token: token
          },
          read: false
        });
      
      if (notifError) {
        console.error('Error creating notification:', notifError);
        // Continue despite notification error
      }
      
      // Send email notification as well (in production, use a proper email service)
      console.log(`Email would be sent to existing user ${email} about invitation to ${groupData.name}`);
      
      return { 
        success: true, 
        invitation,
        userExists: true,
        message: `Invitation sent to existing user ${email}`
      };
    } else {
      // User doesn't exist - create invitation for email signup
      const { data: invitation, error: inviteError } = await supabase
        .from('group_invitations')
        .insert(invitationData)
        .select()
        .single();
      
      if (inviteError) throw inviteError;
      
      // In production, send email with signup link
      // The link would be something like: /signup?invitation=TOKEN
      console.log(`Email would be sent to new user ${email} to create account and join ${groupData.name}`);
      
      return { 
        success: true, 
        invitation,
        userExists: false,
        message: `Invitation sent to new user ${email}`
      };
    }
  } catch (error) {
    console.error('Error inviting roommate:', error);
    return { success: false, error: error.message };
  }
};

// Save home details
export const saveHomeDetails = async (groupId, details, userId) => {
  try {
    if (!groupId || !userId) {
      throw new Error('Missing required parameters');
    }
    
    // Check if user is part of the group
    const { data: memberCheck, error: memberError } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();
    
    if (memberError) throw memberError;
    
    if (!memberCheck) {
      throw new Error('User is not a member of this group');
    }
    
    // Update or insert home details
    const { data: existingDetails, error: checkError } = await supabase
      .from('home_details')
      .select('id')
      .eq('group_id', groupId)
      .maybeSingle();
    
    if (checkError && checkError.code !== 'PGRST116') throw checkError;
    
    if (existingDetails) {
      // Update existing record
      const { error: updateError } = await supabase
        .from('home_details')
        .update({
          ...details,
          updated_at: new Date().toISOString(),
          updated_by: userId
        })
        .eq('id', existingDetails.id);
      
      if (updateError) throw updateError;
    } else {
      // Insert new record
      const { error: insertError } = await supabase
        .from('home_details')
        .insert({
          group_id: groupId,
          ...details,
          created_by: userId,
          updated_by: userId
        });
      
      if (insertError) throw insertError;
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error saving home details:', error);
    return { success: false, error: error.message };
  }
};

// Get home details
export const getHomeDetails = async (groupId) => {
  try {
    if (!groupId) {
      throw new Error('Group ID is required');
    }
    
    const { data, error } = await supabase
      .from('home_details')
      .select('*')
      .eq('group_id', groupId)
      .maybeSingle();
    
    if (error) throw error;
    
    return { success: true, details: data || {} };
  } catch (error) {
    console.error('Error fetching home details:', error);
    return { success: false, error: error.message };
  }
};

// Remove a roommate
export const removeRoommate = async (groupId, roommateId, currentUserId) => {
  try {
    // Check if current user is admin of the group
    const { data: currentUserRole, error: roleError } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', currentUserId)
      .single();
    
    if (roleError) throw roleError;
    
    if (currentUserRole.role !== 'admin') {
      throw new Error('Only group admins can remove members');
    }
    
    // Remove the roommate
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', roommateId);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error removing roommate:', error);
    return { success: false, error: error.message };
  }
};

// Get roommate details by ID
export const getRoommateById = async (roommateId, currentUserId) => {
  try {
    // Get roommate profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', roommateId)
      .single();
    
    if (profileError) throw profileError;
    
    // Calculate score
    const scoreDetails = await calculateRoommateScore(roommateId, currentUserId);
    
    // Get recent transactions between the roommate and current user
    const { data: transactions, error: transactionsError } = await supabase
      .from('expense_shares')
      .select(`
        *,
        expense:expenses(*)
      `)
      .or(`user_id.eq.${roommateId},created_by.eq.${roommateId}`)
      .or(`user_id.eq.${currentUserId},created_by.eq.${currentUserId}`)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (transactionsError) {
      console.warn('Error fetching transactions:', transactionsError);
      // Continue without transactions
    }
    
    return { 
      success: true, 
      roommate: {
        ...profile,
        paymentScore: scoreDetails.score,
        outstandingAmount: scoreDetails.outstandingAmount,
        recentTransactions: transactions || []
      }
    };
  } catch (error) {
    console.error('Error getting roommate details:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get home roommates based on home group
 */
export const getHomeRoommates = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    // First find the user's home group by checking home_details
    const { data: homeDetails, error: homeError } = await supabase
      .from('home_details')
      .select('group_id')
      .eq('created_by', userId)
      .maybeSingle();
    
    if (homeError && homeError.code !== 'PGRST116') throw homeError;
    
    if (!homeDetails || !homeDetails.group_id) {
      // Alternative: find groups where user is admin that match home groups
      const { data: adminGroups, error: adminError } = await supabase
        .from('group_members')
        .select(`
          group:groups(id, name, description)
        `)
        .eq('user_id', userId)
        .eq('role', 'admin');
      
      if (adminError) throw adminError;
      
      // Look for groups that have a description containing "Home group"
      const homeGroup = adminGroups?.find(g => 
        g.group?.description?.includes('Home group')
      )?.group;
      
      if (!homeGroup) {
        return { success: true, roommates: [], groupId: null };
      }
      
      // Use this group as the home group
      const groupId = homeGroup.id;
      
      // Find all members in the group
      const { data: roommateMembers, error: membersError } = await supabase
        .from('group_members')
        .select(`
          user_id,
          role,
          joined_at,
          profile:profiles(*)
        `)
        .eq('group_id', groupId)
        .neq('user_id', userId); // Exclude current user
      
      if (membersError) throw membersError;
      
      if (!roommateMembers || roommateMembers.length === 0) {
        return { success: true, roommates: [], groupId };
      }
      
      // Format the roommate data
      const roommates = roommateMembers.map(member => ({
        id: member.user_id,
        name: member.profile?.full_name || 'Unknown',
        email: member.profile?.email,
        profileImage: member.profile?.avatar_url,
        joinDate: member.joined_at,
        role: member.role,
        group_id: groupId,
        status: 'active'
      }));
      
      return { success: true, roommates, groupId };
    }
    
    // If we found a home group via home_details
    const groupId = homeDetails.group_id;
    
    // Find all members in the group
    const { data: roommateMembers, error: membersError } = await supabase
      .from('group_members')
      .select(`
        user_id,
        role,
        joined_at,
        profile:profiles(*)
      `)
      .eq('group_id', groupId)
      .neq('user_id', userId); // Exclude current user
    
    if (membersError) throw membersError;
    
    if (!roommateMembers || roommateMembers.length === 0) {
      return { success: true, roommates: [], groupId };
    }
    
    // Format the roommate data
    const roommates = roommateMembers.map(member => ({
      id: member.user_id,
      name: member.profile?.full_name || 'Unknown',
      email: member.profile?.email,
      profileImage: member.profile?.avatar_url,
      joinDate: member.joined_at,
      role: member.role,
      group_id: groupId,
      status: 'active'
    }));
    
    return { success: true, roommates, groupId };
  } catch (error) {
    console.error('Error fetching home roommates:', error);
    return { success: false, error: error.message, roommates: [], groupId: null };
  }
};

/**
 * Get roommates by specific group ID with enhanced error handling
 * @param {string} groupId - The group ID
 * @param {string} userId - The current user's ID
 * @returns {Promise<Object>} - Object containing success status and roommates array
 */
export const getRoommatesByGroupId = async (groupId, userId) => {
  console.log(`Getting roommates for group ${groupId}, excluding user ${userId}`);
  try {
    // Find all members in the group
    const { data: roommateMembers, error: membersError } = await supabase
      .from('group_members')
      .select(`
        user_id,
        role,
        joined_at,
        profile:profiles(id, full_name, email, avatar_url)
      `)
      .eq('group_id', groupId)
      .neq('user_id', userId); // Exclude current user
    
    if (membersError) {
      console.error('Error fetching group members:', membersError);
      throw membersError;
    }
    
    console.log(`Found ${roommateMembers?.length || 0} roommate members in group ${groupId}`);
    
    if (!roommateMembers || roommateMembers.length === 0) {
      return { success: true, roommates: [] };
    }
    
    // Format the roommate data
    const roommates = roommateMembers.map(member => ({
      id: member.user_id,
      name: member.profile?.full_name || 'Unknown',
      full_name: member.profile?.full_name || 'Unknown',
      email: member.profile?.email,
      avatar_url: member.profile?.avatar_url,
      joined_at: member.joined_at,
      role: member.role,
      group_id: groupId,
      status: 'active'
    }));
    
    // Get payment scores for each roommate (optional, can be slow)
    // For faster performance you can comment this out
    let roommatesWithScores = roommates;
    try {
      roommatesWithScores = await Promise.all(
        roommates.map(async roommate => {
          try {
            const scoreDetails = await calculateRoommateScore(roommate.id, userId);
            return {
              ...roommate,
              paymentScore: scoreDetails.score,
              outstandingAmount: scoreDetails.outstandingAmount || 0
            };
          } catch (err) {
            console.warn(`Error calculating score for roommate ${roommate.id}:`, err);
            return {
              ...roommate,
              paymentScore: 85, // Default score
              outstandingAmount: 0
            };
          }
        })
      );
    } catch (scoreError) {
      console.warn('Error calculating scores, using base roommate data:', scoreError);
    }
    
    return { success: true, roommates: roommatesWithScores };
  } catch (error) {
    console.error('Error fetching roommates by group ID:', error);
    return { success: false, error: error.message, roommates: [] };
  }
};

/**
 * Save home details and create/update home group
 * @param {string} userId - The current user's ID
 * @param {Object} homeDetails - The home details
 * @returns {Promise<Object>} - Object containing success status and home details
 */
export const saveHomeDetailsWithGroup = async (userId, homeDetails) => {
  try {
    console.log("🏡 [DEBUG] saveHomeDetailsWithGroup - STARTED with:", { 
      userId, 
      homeDetailsId: homeDetails.id, 
      homeName: homeDetails.name,
      existingGroupId: homeDetails.group_id 
    });
    
    if (!userId) {
      console.error("🏡 [DEBUG] saveHomeDetailsWithGroup - ERROR: Missing user ID");
      throw new Error('User ID is required');
    }
    
    if (!homeDetails.name) {
      console.error("🏡 [DEBUG] saveHomeDetailsWithGroup - ERROR: Missing home name");
      throw new Error('Home name is required');
    }
    
    // Create or update the home group
    console.log("🏡 [DEBUG] saveHomeDetailsWithGroup - Calling createOrUpdateHomeGroup");
    const { success: groupSuccess, group, error: groupError } = 
      await createOrUpdateHomeGroup(homeDetails, userId);
    
    console.log("🏡 [DEBUG] saveHomeDetailsWithGroup - createOrUpdateHomeGroup result:", { 
      success: groupSuccess, 
      groupId: group?.id, 
      error: groupError 
    });
    
    if (!groupSuccess) {
      console.error("🏡 [DEBUG] saveHomeDetailsWithGroup - Failed to create/update group:", groupError);
      throw new Error(groupError || 'Failed to create home group');
    }
    
    // Update homeDetails with the group_id
    const updatedHomeDetails = {
      ...homeDetails,
      group_id: group.id
    };
    
    console.log("🏡 [DEBUG] saveHomeDetailsWithGroup - Updated home details with group_id:", {
      originalGroupId: homeDetails.group_id,
      newGroupId: group.id
    });
    
    // Check if home_details record exists
    console.log("🏡 [DEBUG] saveHomeDetailsWithGroup - Checking for existing home_details record");
    const { data: existingDetails, error: checkError } = await supabase
      .from('home_details')
      .select('id')
      .eq('created_by', userId)
      .maybeSingle();
    
    console.log("🏡 [DEBUG] saveHomeDetailsWithGroup - Existing home_details check result:", { 
      found: !!existingDetails, 
      id: existingDetails?.id,
      error: checkError ? `${checkError.code}: ${checkError.message}` : null
    });
    
    if (checkError && checkError.code !== 'PGRST116') throw checkError;
    
    let saveResult;
    
    if (existingDetails) {
      // Update existing record
      console.log(`🏡 [DEBUG] saveHomeDetailsWithGroup - Updating existing home_details with id: ${existingDetails.id}`);
      const { data, error } = await supabase
        .from('home_details')
        .update(updatedHomeDetails)
        .eq('id', existingDetails.id)
        .select()
        .single();
      
      if (error) {
        console.error("🏡 [DEBUG] saveHomeDetailsWithGroup - Error updating home_details:", error);
        throw error;
      }
      
      console.log("🏡 [DEBUG] saveHomeDetailsWithGroup - Successfully updated home_details");
      saveResult = data;
    } else {
      // Insert new record
      console.log("🏡 [DEBUG] saveHomeDetailsWithGroup - Creating new home_details record");
      const { data, error } = await supabase
        .from('home_details')
        .insert({
          ...updatedHomeDetails,
          created_by: userId,
          updated_by: userId
        })
        .select()
        .single();
      
      if (error) {
        console.error("🏡 [DEBUG] saveHomeDetailsWithGroup - Error creating home_details:", error);
        throw error;
      }
      
      console.log("🏡 [DEBUG] saveHomeDetailsWithGroup - Successfully created new home_details record");
      saveResult = data;
    }
    
    console.log("🏡 [DEBUG] saveHomeDetailsWithGroup - COMPLETED successfully:", { 
      homeDetailsId: saveResult.id,
      groupId: saveResult.group_id
    });
    
    return { 
      success: true, 
      homeDetails: saveResult,
      group: group
    };
  } catch (error) {
    console.error('🏡 [DEBUG] saveHomeDetailsWithGroup - FAILED with error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Synchronize home details from a group to a specific member
 * Ensures all roommates have the same home information
 * @param {string} groupId - The group ID
 * @param {string} userId - The user ID to sync details to
 * @returns {Promise<Object>} - Success status and result
 */
export const syncHomeDetailsToMember = async (groupId, userId) => {
  try {
    console.log("🏠 [DEBUG] syncHomeDetailsToMember - Started sync for:", { groupId, userId });
    
    if (!groupId || !userId) {
      console.error("🏠 [DEBUG] syncHomeDetailsToMember - Missing required parameters");
      throw new Error('Group ID and User ID are required');
    }
    
    // First, check if the user is a member of the group
    const { data: memberCheck, error: memberError } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();
    
    if (memberError) {
      console.error("🏠 [DEBUG] syncHomeDetailsToMember - Error checking membership:", memberError);
      throw memberError;
    }
    
    if (!memberCheck) {
      console.error("🏠 [DEBUG] syncHomeDetailsToMember - User is not a member of this group");
      throw new Error('User is not a member of this group');
    }
    
    // Get the group's home details
    const { data: sourceDetails, error: sourceError } = await supabase
      .from('home_details')
      .select('*')
      .eq('group_id', groupId)
      .maybeSingle();
    
    if (sourceError) {
      console.error("🏠 [DEBUG] syncHomeDetailsToMember - Error fetching source home details:", sourceError);
      throw sourceError;
    }
    
    if (!sourceDetails) {
      console.log("🏠 [DEBUG] syncHomeDetailsToMember - No home details found for this group");
      return { success: false, message: 'No home details found for this group' };
    }
    
    // Check if user already has home details
    const { data: existingDetails, error: existingError } = await supabase
      .from('home_details')
      .select('id')
      .eq('created_by', userId)
      .maybeSingle();
    
    if (existingError && existingError.code !== 'PGRST116') {
      console.error("🏠 [DEBUG] syncHomeDetailsToMember - Error checking existing details:", existingError);
      throw existingError;
    }
    
    // Prepare the home details data, excluding unique identifiers
    const { id, created_by, updated_by, created_at, updated_at, ...detailsToSync } = sourceDetails;
    
    const syncedDetails = {
      ...detailsToSync,
      created_by: userId,
      updated_by: userId
    };
    
    console.log("🏠 [DEBUG] syncHomeDetailsToMember - Details to sync:", syncedDetails);
    
    if (existingDetails) {
      // Update existing record
      console.log(`🏠 [DEBUG] syncHomeDetailsToMember - Updating existing details for user ${userId}`);
      const { data: updatedDetails, error: updateError } = await supabase
        .from('home_details')
        .update(syncedDetails)
        .eq('id', existingDetails.id)
        .select();
      
      if (updateError) {
        console.error("🏠 [DEBUG] syncHomeDetailsToMember - Error updating home details:", updateError);
        throw updateError;
      }
      
      console.log("🏠 [DEBUG] syncHomeDetailsToMember - Home details updated successfully");
      return { success: true, details: updatedDetails };
    } else {
      // Insert new record
      console.log(`🏠 [DEBUG] syncHomeDetailsToMember - Creating new home details for user ${userId}`);
      const { data: newDetails, error: insertError } = await supabase
        .from('home_details')
        .insert(syncedDetails)
        .select();
      
      if (insertError) {
        console.error("🏠 [DEBUG] syncHomeDetailsToMember - Error creating home details:", insertError);
        throw insertError;
      }
      
      console.log("🏠 [DEBUG] syncHomeDetailsToMember - Home details created successfully");
      return { success: true, details: newDetails };
    }
  } catch (error) {
    console.error("🏠 [DEBUG] syncHomeDetailsToMember - Failed with error:", error);
    return { success: false, error: error.message };
  }
};
