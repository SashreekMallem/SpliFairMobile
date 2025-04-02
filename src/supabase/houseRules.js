import { supabase } from './config';

/**
 * Fetch all house rules for a specific household group
 * @param {string} groupId - The household group ID
 * @returns {Promise<Object>} - Object containing success status, rules array, and any error
 */
export const getHouseRules = async (groupId) => {
  try {
    const { data: rules, error } = await supabase
      .from('house_rules')
      .select(`
        *,
        rule_assignments(user_id)
      `)
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Transform the rules to a more convenient format
    const formattedRules = rules.map(rule => ({
      id: rule.id,
      title: rule.title,
      description: rule.description,
      priority: rule.priority,
      icon: rule.icon,
      createdBy: rule.created_by,
      groupId: rule.group_id,
      createdAt: rule.created_at,
      assignedTo: rule.rule_assignments.map(assignment => assignment.user_id)
    }));
    
    return { success: true, rules: formattedRules };
  } catch (error) {
    console.error('Error fetching house rules:', error);
    return { success: false, error: error.message, rules: [] };
  }
};

/**
 * Create a new house rule
 * @param {Object} ruleData - The rule data
 * @returns {Promise<Object>} - Object containing success status, the created rule, and any error
 */
export const createHouseRule = async (ruleData) => {
  try {
    const { assignedTo, ...ruleInfo } = ruleData;
    
    // Insert the main rule
    const { data: rule, error } = await supabase
      .from('house_rules')
      .insert([ruleInfo])
      .select()
      .single();
    
    if (error) throw error;
    
    // Create assignments if provided
    if (assignedTo && assignedTo.length > 0) {
      const assignments = assignedTo.map(userId => ({
        rule_id: rule.id,
        user_id: userId
      }));
      
      const { error: assignmentError } = await supabase
        .from('rule_assignments')
        .insert(assignments);
      
      if (assignmentError) throw assignmentError;
    }
    
    return { 
      success: true, 
      rule: {
        ...rule,
        assignedTo: assignedTo || []
      }
    };
  } catch (error) {
    console.error('Error creating house rule:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Update an existing house rule
 * @param {number} ruleId - The rule ID to update
 * @param {Object} ruleData - The updated rule data
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const updateHouseRule = async (ruleId, ruleData) => {
  try {
    const { assignedTo, ...ruleInfo } = ruleData;
    
    // Update the main rule
    const { error } = await supabase
      .from('house_rules')
      .update(ruleInfo)
      .eq('id', ruleId);
    
    if (error) throw error;
    
    // Update assignments if provided
    if (assignedTo) {
      // First remove existing assignments
      const { error: deleteError } = await supabase
        .from('rule_assignments')
        .delete()
        .eq('rule_id', ruleId);
      
      if (deleteError) throw deleteError;
      
      // Then add the new assignments
      if (assignedTo.length > 0) {
        const assignments = assignedTo.map(userId => ({
          rule_id: ruleId,
          user_id: userId
        }));
        
        const { error: assignmentError } = await supabase
          .from('rule_assignments')
          .insert(assignments);
        
        if (assignmentError) throw assignmentError;
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error updating house rule:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete a house rule
 * @param {number} ruleId - The rule ID to delete
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const deleteHouseRule = async (ruleId) => {
  try {
    // The rule_assignments will be automatically deleted due to ON DELETE CASCADE
    const { error } = await supabase
      .from('house_rules')
      .delete()
      .eq('id', ruleId);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting house rule:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Assign a roommate to a rule
 * @param {number} ruleId - The rule ID
 * @param {string} userId - The user ID to assign
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const assignRuleToRoommate = async (ruleId, userId) => {
  try {
    const { error } = await supabase
      .from('rule_assignments')
      .insert([{ rule_id: ruleId, user_id: userId }]);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error assigning rule to roommate:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Remove a roommate from a rule
 * @param {number} ruleId - The rule ID
 * @param {string} userId - The user ID to remove
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const removeRoommateFromRule = async (ruleId, userId) => {
  try {
    const { error } = await supabase
      .from('rule_assignments')
      .delete()
      .eq('rule_id', ruleId)
      .eq('user_id', userId);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error removing roommate from rule:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get all agreement clauses for a household
 * @param {string} groupId - The household group ID
 * @returns {Promise<Object>} - Object containing success status, clauses array, and any error
 */
export const getAgreementClauses = async (groupId) => {
  try {
    const { data: clauses, error } = await supabase
      .from('agreement_clauses')
      .select(`
        *,
        clause_signatures(user_id, signed_at)
      `)
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Transform to a more convenient format
    const formattedClauses = clauses.map(clause => {
      const signers = clause.clause_signatures.map(sig => sig.user_id);
      
      return {
        id: clause.id,
        title: clause.title,
        content: clause.content,
        category: clause.category,
        createdBy: clause.created_by,
        createdAt: clause.created_at,
        agreed: signers,
        pending: [] // This would need to be calculated based on group members
      };
    });
    
    return { success: true, clauses: formattedClauses };
  } catch (error) {
    console.error('Error fetching agreement clauses:', error);
    return { success: false, error: error.message, clauses: [] };
  }
};

/**
 * Create a new agreement clause
 * @param {Object} clauseData - The clause data
 * @returns {Promise<Object>} - Object containing success status, the created clause, and any error
 */
export const createClause = async (clauseData) => {
  try {
    const { data: clause, error } = await supabase
      .from('agreement_clauses')
      .insert([clauseData])
      .select()
      .single();
    
    if (error) throw error;
    
    return { success: true, clause };
  } catch (error) {
    console.error('Error creating agreement clause:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Sign an agreement clause
 * @param {number} clauseId - The clause ID
 * @param {string} userId - The user ID signing the clause
 * @returns {Promise<Object>} - Object containing success status and any error
 */
export const signClause = async (clauseId, userId) => {
  try {
    const { error } = await supabase
      .from('clause_signatures')
      .insert([{ clause_id: clauseId, user_id: userId }]);
    
    if (error) throw error;
    
    return { success: true };
  } catch (error) {
    console.error('Error signing clause:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get signature status for a clause
 * @param {number} clauseId - The clause ID
 * @param {string} groupId - The group ID to get members
 * @returns {Promise<Object>} - Object with who has/hasn't signed
 */
export const getClauseSignatureStatus = async (clauseId, groupId) => {
  try {
    // Get all group members
    const { data: members, error: membersError } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId);
    
    if (membersError) throw membersError;
    
    // Get signatures for this clause
    const { data: signatures, error: signaturesError } = await supabase
      .from('clause_signatures')
      .select('user_id')
      .eq('clause_id', clauseId);
    
    if (signaturesError) throw signaturesError;
    
    const signedUserIds = signatures.map(s => s.user_id);
    const allUserIds = members.map(m => m.user_id);
    
    // Find who hasn't signed
    const pendingUserIds = allUserIds.filter(id => !signedUserIds.includes(id));
    
    return { 
      success: true, 
      agreed: signedUserIds,
      pending: pendingUserIds
    };
  } catch (error) {
    console.error('Error getting clause signature status:', error);
    return { success: false, error: error.message };
  }
};
