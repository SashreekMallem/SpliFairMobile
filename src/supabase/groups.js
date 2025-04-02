import { supabase } from './config';

// Get all groups for a user
export const getUserGroups = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('group_members')
      .select(`
        *,
        group:groups(*)
      `)
      .eq('user_id', userId);
    
    if (error) throw error;
    
    // Transform the data to a more usable format
    const groups = data.map(item => ({
      ...item.group,
      role: item.role
    }));
    
    return { success: true, groups };
  } catch (error) {
    console.error('Error fetching user groups:', error.message);
    return { success: false, error: error.message };
  }
};

// Create a new group
export const createGroup = async (groupData, creatorId) => {
  try {
    console.log('Creating group with creator ID:', creatorId);
    
    // Create the group first
    console.log('Creating group in database');
    const { data: newGroup, error: groupError } = await supabase
      .from('groups')
      .insert({
        name: groupData.name,
        description: groupData.description || '',
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (groupError) {
      console.error('Error creating group:', groupError);
      throw groupError;
    }
    
    console.log('Group created successfully:', newGroup.id);
    
    // Now add creator as admin using a different approach to avoid policy recursion
    console.log('Adding creator as group member with admin role');
    
    // Use RPC function if available to bypass policy checks
    try {
      const { error: rpcError } = await supabase.rpc('add_group_creator', {
        group_id_param: newGroup.id,
        user_id_param: creatorId,
        role_param: 'admin'
      });
      
      if (rpcError) {
        console.warn('RPC method failed, trying direct insert:', rpcError);
        throw rpcError; // Try the fallback method
      }
      
      console.log('Creator added via RPC successfully');
    } catch (rpcError) {
      // Fallback: Try direct insert with service role if available
      console.log('Using fallback method to add creator');
      
      // Try adding through direct insert (may still trigger policy)
      const { error: memberError } = await supabase
        .from('group_members')
        .insert({
          group_id: newGroup.id,
          user_id: creatorId,
          role: 'admin',
          joined_at: new Date().toISOString()
        });
      
      if (memberError) {
        console.error('Error adding creator as member:', memberError);
        // Don't throw here - return the group even if member add fails
        // The user can be added later through the UI
      }
    }
    
    return { success: true, group: newGroup };
  } catch (error) {
    console.error('Error creating group:', error.message);
    return { success: false, error: error.message };
  }
};

// Add a member to a group
export const addGroupMember = async (groupId, email, role = 'member') => {
  try {
    // First, find user by email
    const { data: userData, error: userError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();
    
    if (userError) throw userError;
    
    // Then add them to the group
    const { data, error } = await supabase
      .from('group_members')
      .insert({
        group_id: groupId,
        user_id: userData.id,
        role: role
      })
      .select();
    
    if (error) throw error;
    return { success: true, member: data[0] };
  } catch (error) {
    console.error('Error adding group member:', error.message);
    return { success: false, error: error.message };
  }
};

// Get group members
export const getGroupMembers = async (groupId) => {
  try {
    const { data, error } = await supabase
      .from('group_members')
      .select(`
        *,
        profile:profiles(id, full_name, email, avatar_url)
      `)
      .eq('group_id', groupId);
    
    if (error) throw error;
    return { success: true, members: data };
  } catch (error) {
    console.error('Error fetching group members:', error.message);
    return { success: false, error: error.message };
  }
};

// Remove a member from a group
export const removeGroupMember = async (groupId, userId) => {
  try {
    const { error } = await supabase
      .from('group_members')
      .delete()
      .match({ group_id: groupId, user_id: userId });
    
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error removing group member:', error.message);
    return { success: false, error: error.message };
  }
};

// Update a group
export const updateGroup = async (groupId, updates) => {
  try {
    const { data, error } = await supabase
      .from('groups')
      .update(updates)
      .eq('id', groupId)
      .select();
    
    if (error) throw error;
    return { success: true, group: data[0] };
  } catch (error) {
    console.error('Error updating group:', error.message);
    return { success: false, error: error.message };
  }
};

// Create a group invitation with proper notifications
export const createGroupInvitation = async (groupId, email, invitedBy) => {
  try {
    if (!groupId || !email || !invitedBy) {
      return { success: false, error: 'Missing required parameters' };
    }

    console.log(`Creating invitation to group ${groupId} for ${email}`);
    
    // First check if the email corresponds to an existing user
    const { data: existingUsers, error: userError } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', email.toLowerCase())
      .limit(1);
    
    if (userError) throw userError;
    
    const existingUser = existingUsers && existingUsers.length > 0 ? existingUsers[0] : null;
    const userId = existingUser?.id;
    
    // Check if user is already in the group
    if (userId) {
      const { data: existingMember, error: memberError } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .limit(1);
      
      if (memberError) throw memberError;
      
      if (existingMember && existingMember.length > 0) {
        return { success: false, error: 'User is already a member of this group' };
      }
    }
    
    // Check if invitation already exists
    const { data: existingInvites, error: inviteError } = await supabase
      .from('group_invitations')
      .select('*')
      .eq('group_id', groupId)
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .limit(1);
    
    if (inviteError) throw inviteError;
    
    if (existingInvites && existingInvites.length > 0) {
      return { success: false, error: 'An invitation has already been sent to this email' };
    }
    
    // Generate a unique invitation token
    const token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    
    // Create the invitation record
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 14); // Expire in 14 days
    
    const { data: invitation, error: createError } = await supabase
      .from('group_invitations')
      .insert({
        group_id: groupId,
        email: email.toLowerCase(),
        invited_by: invitedBy,
        token: token,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: expiryDate.toISOString()
      })
      .select()
      .single();
    
    if (createError) throw createError;
    
    // If user exists, create a notification - FIX THIS PART
    if (userId) {
      // Get group information for the notification
      const { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select('name')
        .eq('id', groupId)
        .single();
      
      if (groupError) throw groupError;
      
      // Get inviter's name
      const { data: inviterData, error: inviterError } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', invitedBy)
        .single();
      
      if (inviterError) throw inviterError;
      
      // Create in-app notification WITH THE CORRECT TOKEN
      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          type: 'invitation',
          title: 'Group Invitation',
          message: `${inviterData.full_name} invited you to join ${groupData.name}`,
          read: false,
          data: {
            group_id: groupId,
            group_name: groupData.name,
            invited_by: invitedBy,
            inviter_name: inviterData.full_name,
            token: token,  // Make sure token is included!
            type: 'expense' // Regular expense group type
          }
        });
      
      if (notifError) console.error('Error creating notification:', notifError);
    }
    
    // Email would be sent here in a real production app
    // For now, just log that we would send an email
    console.log(`Would send invitation email to ${email} with token ${token}`);
    
    return { 
      success: true, 
      invitation: invitation,
      isExistingUser: !!userId
    };
  } catch (error) {
    console.error('Error creating group invitation:', error);
    return { success: false, error: error.message };
  }
};

// Get all invitations for a specific group
export const getGroupInvitations = async (groupId) => {
  try {
    const { data, error } = await supabase
      .from('group_invitations')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return { success: true, invitations: data };
  } catch (error) {
    console.error('Error fetching group invitations:', error.message);
    return { success: false, error: error.message };
  }
};

// Get invitations sent to a specific email
export const getInvitationsByEmail = async (email) => {
  try {
    const { data, error } = await supabase
      .from('group_invitations')
      .select(`
        *,
        group:groups(id, name, description),
        inviter:profiles(id, full_name, avatar_url)
      `)
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return { success: true, invitations: data || [] };
  } catch (error) {
    console.error('Error fetching invitations by email:', error);
    return { success: false, error: error.message, invitations: [] };
  }
};

// Accept a group invitation
export const acceptGroupInvitation = async (token, userId) => {
  try {
    // We'll use the database function for this to ensure atomicity
    const { data, error } = await supabase.rpc('accept_group_invitation', {
      invitation_token: token,
      user_id_param: userId
    });
    
    if (error) throw error;
    
    // Get group details to return
    const groupId = data;
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', groupId)
      .single();
    
    if (groupError) throw groupError;
    
    return { success: true, group: group };
  } catch (error) {
    console.error('Error accepting group invitation:', error);
    return { success: false, error: error.message };
  }
};

// Reject a group invitation
export const rejectGroupInvitation = async (token) => {
  try {
    const { data, error } = await supabase
      .from('group_invitations')
      .update({ status: 'rejected' })
      .eq('token', token)
      .select();
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error rejecting group invitation:', error.message);
    return { success: false, error: error.message };
  }
};

// Cancel a group invitation (by the inviter)
export const cancelGroupInvitation = async (invitationId) => {
  try {
    const { error } = await supabase
      .from('group_invitations')
      .delete()
      .eq('id', invitationId);
    
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error canceling invitation:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Create or update a home group based on home details with improved home-specific logic
 */
export const createOrUpdateHomeGroup = async (homeDetails, userId) => {
  try {
    console.log("🏠 [DEBUG] createOrUpdateHomeGroup - STARTED with:", { 
      homeName: homeDetails.name, 
      homeId: homeDetails.id,
      existingGroupId: homeDetails.group_id,
      userId 
    });
    
    if (!homeDetails.name) {
      console.error("🏠 [DEBUG] createOrUpdateHomeGroup - ERROR: Missing home name");
      throw new Error('Home name is required to create a home group');
    }
    
    if (!userId) {
      console.error("🏠 [DEBUG] createOrUpdateHomeGroup - ERROR: Missing user ID");
      throw new Error('User ID is required');
    }
    
    // Format address for use in description
    const addressParts = [];
    if (homeDetails.street) addressParts.push(homeDetails.street);
    if (homeDetails.city) addressParts.push(homeDetails.city);
    if (homeDetails.state) addressParts.push(homeDetails.state);
    
    const addressStr = addressParts.length > 0 
      ? ` at ${addressParts.join(', ')}` 
      : '';
    
    // Check if this home already has a group_id
    if (homeDetails.group_id) {
      console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - Home has existing group_id: ${homeDetails.group_id}`);
      
      // Update existing group
      const { data: existingGroup, error: checkError } = await supabase
        .from('groups')
        .select('id, name, description')
        .eq('id', homeDetails.group_id)
        .single();
      
      console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - Existing group search result:`, {
        found: !!existingGroup,
        group: existingGroup,
        error: checkError ? `${checkError.code}: ${checkError.message}` : null
      });
      
      if (checkError && checkError.code !== 'PGRST116') {
        console.error(`🏠 [DEBUG] createOrUpdateHomeGroup - Error fetching existing group:`, checkError);
        throw checkError;
      }
      
      if (existingGroup) {
        // Check if the user is already a member of this group
        const { data: membership, error: membershipError } = await supabase
          .from('group_members')
          .select('id, role')
          .eq('group_id', existingGroup.id)
          .eq('user_id', userId)
          .maybeSingle();
          
        if (membershipError) {
          console.warn(`🏠 [DEBUG] createOrUpdateHomeGroup - Error checking membership:`, membershipError);
        }
        
        // If user is not a member, add them now
        if (!membership) {
          console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - Adding creator ${userId} to existing group ${existingGroup.id}`);
          
          const { error: addError } = await supabase
            .from('group_members')
            .insert({
              group_id: existingGroup.id,
              user_id: userId,
              role: 'admin', // Assuming creator should be admin
              joined_at: new Date().toISOString()
            });
            
          if (addError) {
            console.error(`🏠 [DEBUG] createOrUpdateHomeGroup - Error adding user to existing group:`, addError);
            // Continue anyway - at least the group exists
          } else {
            console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - Successfully added user to existing group`);
          }
        } else {
          console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - User is already a member with role: ${membership.role}`);
        }
        
        // Update the group if details changed
        const needsUpdate = existingGroup.name !== homeDetails.name || 
                            !existingGroup.description?.includes('Home group');
        
        console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - Group needs update: ${needsUpdate}`, {
          currentName: existingGroup.name,
          newName: homeDetails.name,
          currentDesc: existingGroup.description
        });
        
        if (needsUpdate) {
          const { error: updateError } = await supabase
            .from('groups')
            .update({
              name: homeDetails.name,
              description: `Home group for ${homeDetails.name}${addressStr}`,
              updated_at: new Date().toISOString()
            })
            .eq('id', homeDetails.group_id);
          
          if (updateError) {
            console.error(`🏠 [DEBUG] createOrUpdateHomeGroup - Error updating group:`, updateError);
            throw updateError;
          }
          
          console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - Group successfully updated with new details`);
        }
        
        console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - COMPLETED (existing group)`, {
          groupId: existingGroup.id,
          updatedName: homeDetails.name
        });
        
        return { 
          success: true, 
          group: { 
            ...existingGroup, 
            name: homeDetails.name,
            description: `Home group for ${homeDetails.name}${addressStr}`
          } 
        };
      }
    }
    
    // If no existing group or couldn't find it, create a new one
    console.log('🏠 [DEBUG] createOrUpdateHomeGroup - Creating NEW home group with name:', homeDetails.name);
    
    const { data: newGroup, error: groupError } = await supabase
      .from('groups')
      .insert({
        name: homeDetails.name,
        description: `Home group for ${homeDetails.name}${addressStr}`,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (groupError) {
      console.error('🏠 [DEBUG] createOrUpdateHomeGroup - Error creating new group:', groupError);
      throw groupError;
    }
    
    console.log('🏠 [DEBUG] createOrUpdateHomeGroup - NEW group created successfully with ID:', newGroup.id);
    
    // Add creator as admin - add a direct method first, then try RPC as fallback
    console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - Adding creator ${userId} as admin to new group ${newGroup.id}`);
    
    // DIRECTLY add the user first - this is the most reliable method
    const { error: directError } = await supabase
      .from('group_members')
      .insert({
        group_id: newGroup.id,
        user_id: userId,
        role: 'admin',
        joined_at: new Date().toISOString()
      });
    
    if (directError) {
      console.error('🏠 [DEBUG] createOrUpdateHomeGroup - Error with direct member insertion:', directError);
      
      // If direct insertion fails, try the RPC method
      try {
        const { error: rpcError } = await supabase.rpc('add_group_creator', {
          group_id_param: newGroup.id,
          user_id_param: userId,
          role_param: 'admin'
        });
        
        if (rpcError) {
          console.error(`🏠 [DEBUG] createOrUpdateHomeGroup - Both member insertion methods failed:`, rpcError);
          // Continue anyway - let the app handle this case
        } else {
          console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - Creator added via RPC method`);
        }
      } catch (err) {
        console.error('🏠 [DEBUG] createOrUpdateHomeGroup - Error with RPC method:', err);
      }
    } else {
      console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - Creator successfully added to group directly`);
    }
    
    // Double check the membership was created
    const { data: memberCheck, error: checkError } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', newGroup.id)
      .eq('user_id', userId)
      .single();
      
    if (checkError || !memberCheck) {
      console.error(`🏠 [DEBUG] createOrUpdateHomeGroup - Creator membership verification failed:`, 
        checkError || 'No membership found');
    } else {
      console.log(`🏠 [DEBUG] createOrUpdateHomeGroup - Creator membership verified with ID: ${memberCheck.id}`);
    }
    
    console.log('🏠 [DEBUG] createOrUpdateHomeGroup - COMPLETED (new group):', {
      newGroupId: newGroup.id, 
      success: true
    });
    
    return { success: true, group: newGroup };
  } catch (error) {
    console.error('🏠 [DEBUG] createOrUpdateHomeGroup - FAILED with error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Enhanced function to invite users with better error handling and notifications
 */
export const inviteUserToGroup = async (groupId, email, invitedBy, isHomeInvite = false, homeDetails = null) => {
  try {
    // Input validation
    if (!groupId) return { success: false, error: 'Missing group ID' };
    if (!email || !email.includes('@')) return { success: false, error: 'Invalid email address' };
    if (!invitedBy) return { success: false, error: 'Missing inviter ID' };
    
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if group exists and get its information
    const { data: groupData, error: groupError } = await supabase
      .from('groups')
      .select('name, description')
      .eq('id', groupId)
      .single();
    
    if (groupError) {
      console.error('Error fetching group:', groupError);
      throw new Error('Group not found');
    }
    
    // Check if invitation already exists
    const { data: existingInvite, error: checkError } = await supabase
      .from('group_invitations')
      .select('*')
      .eq('group_id', groupId)
      .eq('email', normalizedEmail)
      .eq('status', 'pending');
    
    if (checkError) {
      console.error('Error checking existing invitations:', checkError);
      throw checkError;
    }
    
    if (existingInvite?.length > 0) {
      return { 
        success: false, 
        error: 'An invitation has already been sent to this email',
        existingInvite: existingInvite[0]
      };
    }
    
    // Check if user already exists in system
    const { data: userData, error: userError } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .eq('email', normalizedEmail)
      .maybeSingle();
    
    // Get inviter details for notification
    const { data: inviterData, error: inviterError } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', invitedBy)
      .single();
    
    if (inviterError) {
      console.warn('Could not get inviter details:', inviterError);
      // Continue anyway with limited information
    }
    
    const inviterName = inviterData?.full_name || 'Someone';
    
    // Prepare the invitation token
    const token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    
    // Invitation type (home invitation or regular group)
    const invitationType = isHomeInvite ? 'roommate' : 'group';
    
    // Set expiration date (7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    // Create invitation record with additional context
    const { data: invitation, error: inviteError } = await supabase
      .from('group_invitations')
      .insert({
        group_id: groupId,
        email: normalizedEmail,
        invited_by: invitedBy,
        token: token,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        home_details: isHomeInvite ? homeDetails : null
      })
      .select()
      .single();
    
    if (inviteError) {
      console.error('Error creating invitation:', inviteError);
      throw inviteError;
    }
    
    // If user exists in system, create in-app notification
    if (userData?.id) {
      const notificationMessage = isHomeInvite
        ? `${inviterName} invited you to join "${groupData.name}" as a roommate`
        : `${inviterName} invited you to join the group "${groupData.name}"`;
        
      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          user_id: userData.id,
          type: 'invitation',
          title: isHomeInvite ? 'New Roommate Invitation' : 'New Group Invitation',
          message: notificationMessage,
          data: { 
            invitation_id: invitation.id,
            group_id: groupId,
            group_name: groupData.name,
            inviter_name: inviterName,
            token: token,
            type: invitationType
          },
          read: false
        });
      
      if (notifError) {
        console.warn('Failed to create notification:', notifError);
        // Continue with invitation process regardless
      }
    }
    
    // Return success with relevant information
    return { 
      success: true, 
      invitation,
      userExists: !!userData,
      groupName: groupData.name,
      inviterName,
      token
    };
  } catch (error) {
    console.error('Error inviting user to group:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to send invitation' 
    };
  }
};
