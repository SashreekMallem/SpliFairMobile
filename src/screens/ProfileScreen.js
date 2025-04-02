import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../utils/supabaseClient';
import { useAuth } from '../context/AuthContext';

const ProfileScreen = ({ navigation }) => {
  // Auth context
  const { currentUser, userProfile, signOut } = useAuth();
  
  // UI state
  const [activeTab, setActiveTab] = useState('personal');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Form data
  const [personalInfo, setPersonalInfo] = useState({
    full_name: '',
    email: '',
    phone: '',
    location: '',
    bio: '',
    avatar_url: null,
  });
  
  const [paymentInfo, setPaymentInfo] = useState({
    preferred_payment: 'venmo',
    preferred_currency: 'USD',
    venmo_username: '',
    paypal_email: '',
  });
  
  const [securityInfo, setSecurityInfo] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
    email_verified: false,
  });
  
  const [notificationSettings, setNotificationSettings] = useState({
    email_notifications: true,
    expense_added: true,
    expense_updated: true,
    payment_reminder: true,
    monthly_summary: true,
    push_notifications: true,
  });
  
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // Load user data when profile changes
  useEffect(() => {
    console.log('ProfileScreen: Loading user data');
    console.log('Current user:', currentUser);
    console.log('User profile:', userProfile);
    
    if (!currentUser && !userProfile) {
      console.warn('No user data found, redirecting to Login');
      navigation.navigate('Login');
      return;
    }
    
    if (userProfile) {
      // Populate personal info
      setPersonalInfo({
        full_name: userProfile.full_name || '',
        email: currentUser?.email || '',
        phone: userProfile.phone || '',
        location: userProfile.location || '',
        bio: userProfile.bio || '',
        avatar_url: userProfile.avatar_url || null,
      });
      
      // Populate payment info
      setPaymentInfo({
        preferred_payment: userProfile.preferred_payment || 'venmo',
        preferred_currency: userProfile.preferred_currency || 'USD',
        venmo_username: userProfile.venmo_username || '',
        paypal_email: userProfile.paypal_email || '',
      });
      
      // Security info
      setSecurityInfo(prev => ({
        ...prev,
        email_verified: userProfile.email_verified || false,
      }));
      
      // Notification settings
      if (userProfile.notification_settings) {
        setNotificationSettings({
          ...notificationSettings,
          ...userProfile.notification_settings
        });
      }
      
      // Load user's groups
      fetchUserGroups();
    }
  }, [userProfile, currentUser]);
  
  // Fetch user's household groups
  const fetchUserGroups = async () => {
    if (!currentUser?.id) return;
    
    setLoadingGroups(true);
    try {
      console.log('Fetching groups for user:', currentUser.id);
      
      const { data, error } = await supabase
        .from('group_members')
        .select(`
          group_id,
          role,
          joined_at,
          groups:group_id (
            id,
            name,
            description,
            created_at,
            home_id,
            homes:home_id (
              name,
              address,
              city,
              state,
              zip_code
            )
          )
        `)
        .eq('user_id', currentUser.id);
      
      if (error) throw error;
      
      console.log('Fetched groups:', data);
      setGroups(data || []);
    } catch (error) {
      console.error('Error fetching user groups:', error);
      Alert.alert('Error', 'Failed to load your groups');
    } finally {
      setLoadingGroups(false);
    }
  };
  
  // Handle profile form update
  const handleUpdateProfile = async () => {
    if (!personalInfo.full_name.trim()) {
      Alert.alert('Error', 'Name cannot be empty');
      return;
    }
    
    setLoading(true);
    try {
      const updates = {
        full_name: personalInfo.full_name,
        phone: personalInfo.phone,
        location: personalInfo.location,
        bio: personalInfo.bio,
        preferred_payment: paymentInfo.preferred_payment,
        preferred_currency: paymentInfo.preferred_currency,
        venmo_username: paymentInfo.venmo_username,
        paypal_email: paymentInfo.paypal_email,
        updated_at: new Date(),
      };
      
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', currentUser.id);
        
      if (error) throw error;
      
      Alert.alert('Success', 'Profile updated successfully');
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', error.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };
  
  // Handle password change
  const handleUpdatePassword = async () => {
    const { current_password, new_password, confirm_password } = securityInfo;
    
    // Validation
    if (!current_password || !new_password || !confirm_password) {
      Alert.alert('Error', 'All password fields are required');
      return;
    }
    
    if (new_password !== confirm_password) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }
    
    if (new_password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: new_password
      });
      
      if (error) throw error;
      
      Alert.alert('Success', 'Password updated successfully');
      setSecurityInfo({
        current_password: '',
        new_password: '',
        confirm_password: '',
        email_verified: securityInfo.email_verified
      });
    } catch (error) {
      console.error('Error updating password:', error);
      Alert.alert('Error', error.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };
  
  // Handle notification settings update
  const handleUpdateNotifications = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          notification_settings: notificationSettings,
          updated_at: new Date()
        })
        .eq('id', currentUser.id);
        
      if (error) throw error;
      
      Alert.alert('Success', 'Notification settings updated');
    } catch (error) {
      console.error('Error updating notifications:', error);
      Alert.alert('Error', error.message || 'Failed to update notification settings');
    } finally {
      setLoading(false);
    }
  };
  
  // Handle leaving a group
  const handleLeaveGroup = (groupId, groupName) => {
    Alert.alert(
      'Leave Group',
      `Are you sure you want to leave "${groupName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Leave', 
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('group_members')
                .delete()
                .eq('user_id', currentUser.id)
                .eq('group_id', groupId);
                
              if (error) throw error;
              
              Alert.alert('Success', `You've left the group "${groupName}"`);
              fetchUserGroups();
            } catch (error) {
              console.error('Error leaving group:', error);
              Alert.alert('Error', error.message || 'Failed to leave group');
            }
          }
        }
      ]
    );
  };
  
  // Handle user logout
  const handleLogout = async () => {
    try {
      const { error } = await signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Error signing out:', error);
      Alert.alert('Error', error.message || 'Failed to log out');
    }
  };
  
  // Handle account deletion
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const { error } = await supabase.rpc('delete_user_account');
              
              if (error) throw error;
              
              await signOut();
            } catch (error) {
              console.error('Error deleting account:', error);
              Alert.alert('Error', error.message || 'Failed to delete account');
              setLoading(false);
            }
          }
        }
      ]
    );
  };
  
  // Render tab content based on active tab
  const renderTabContent = () => {
    switch (activeTab) {
      // Personal Information Tab
      case 'personal':
        return (
          <View style={styles.tabContent}>
            {/* Personal Information Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Personal Information</Text>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Full Name</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.input}
                    value={personalInfo.full_name}
                    onChangeText={(text) => setPersonalInfo({...personalInfo, full_name: text})}
                    placeholder="Your full name"
                    placeholderTextColor="#9CA3AF"
                  />
                ) : (
                  <Text style={styles.value}>{personalInfo.full_name || 'Not provided'}</Text>
                )}
              </View>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Email</Text>
                <Text style={styles.value}>{personalInfo.email}</Text>
              </View>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Phone</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.input}
                    value={personalInfo.phone}
                    onChangeText={(text) => setPersonalInfo({...personalInfo, phone: text})}
                    placeholder="Your phone number"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="phone-pad"
                  />
                ) : (
                  <Text style={styles.value}>{personalInfo.phone || 'Not provided'}</Text>
                )}
              </View>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Location</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.input}
                    value={personalInfo.location}
                    onChangeText={(text) => setPersonalInfo({...personalInfo, location: text})}
                    placeholder="Your location"
                    placeholderTextColor="#9CA3AF"
                  />
                ) : (
                  <Text style={styles.value}>{personalInfo.location || 'Not provided'}</Text>
                )}
              </View>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Bio</Text>
                {isEditing ? (
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={personalInfo.bio}
                    onChangeText={(text) => setPersonalInfo({...personalInfo, bio: text})}
                    placeholder="Tell us about yourself"
                    placeholderTextColor="#9CA3AF"
                    multiline
                    numberOfLines={4}
                  />
                ) : (
                  <Text style={styles.value}>{personalInfo.bio || 'No bio provided'}</Text>
                )}
              </View>
            </View>

            {/* Payment Preferences Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Payment Preferences</Text>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Preferred Payment Method</Text>
                {isEditing ? (
                  <View style={styles.radioGroup}>
                    {['venmo', 'paypal', 'cash', 'bank_transfer'].map(method => (
                      <TouchableOpacity
                        key={method}
                        style={[
                          styles.radioOption,
                          paymentInfo.preferred_payment === method && styles.radioOptionSelected
                        ]}
                        onPress={() => setPaymentInfo({...paymentInfo, preferred_payment: method})}
                      >
                        <Text 
                          style={[
                            styles.radioText,
                            paymentInfo.preferred_payment === method && styles.radioTextSelected
                          ]}
                        >
                          {method.charAt(0).toUpperCase() + method.slice(1).replace('_', ' ')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.value}>
                    {paymentInfo.preferred_payment ? 
                      paymentInfo.preferred_payment.charAt(0).toUpperCase() + 
                      paymentInfo.preferred_payment.slice(1).replace('_', ' ')
                      : 'Not specified'
                    }
                  </Text>
                )}
              </View>
              
              {(isEditing || paymentInfo.preferred_payment === 'venmo') && (
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Venmo Username</Text>
                  {isEditing ? (
                    <TextInput
                      style={styles.input}
                      value={paymentInfo.venmo_username}
                      onChangeText={(text) => setPaymentInfo({...paymentInfo, venmo_username: text})}
                      placeholder="Your Venmo username"
                      placeholderTextColor="#9CA3AF"
                    />
                  ) : (
                    <Text style={styles.value}>
                      {paymentInfo.venmo_username || 'Not provided'}
                    </Text>
                  )}
                </View>
              )}
              
              {(isEditing || paymentInfo.preferred_payment === 'paypal') && (
                <View style={styles.formGroup}>
                  <Text style={styles.label}>PayPal Email</Text>
                  {isEditing ? (
                    <TextInput
                      style={styles.input}
                      value={paymentInfo.paypal_email}
                      onChangeText={(text) => setPaymentInfo({...paymentInfo, paypal_email: text})}
                      placeholder="Your PayPal email"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="email-address"
                    />
                  ) : (
                    <Text style={styles.value}>
                      {paymentInfo.paypal_email || 'Not provided'}
                    </Text>
                  )}
                </View>
              )}
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Preferred Currency</Text>
                {isEditing ? (
                  <View style={styles.radioGroup}>
                    {['USD', 'EUR', 'GBP', 'CAD'].map(currency => (
                      <TouchableOpacity
                        key={currency}
                        style={[
                          styles.radioOption,
                          paymentInfo.preferred_currency === currency && styles.radioOptionSelected
                        ]}
                        onPress={() => setPaymentInfo({...paymentInfo, preferred_currency: currency})}
                      >
                        <Text 
                          style={[
                            styles.radioText,
                            paymentInfo.preferred_currency === currency && styles.radioTextSelected
                          ]}
                        >
                          {currency}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.value}>{paymentInfo.preferred_currency || 'USD'}</Text>
                )}
              </View>
              
              {isEditing && (
                <TouchableOpacity 
                  style={styles.saveButton}
                  onPress={handleUpdateProfile}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.saveButtonText}>Save Changes</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
        
      // Security Tab
      case 'security':
        return (
          <View style={styles.tabContent}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Account Security</Text>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Email</Text>
                <Text style={styles.value}>{personalInfo.email}</Text>
                <View style={styles.verificationStatus}>
                  <Ionicons 
                    name={securityInfo.email_verified ? "checkmark-circle" : "alert-circle"} 
                    size={16} 
                    color={securityInfo.email_verified ? "#10B981" : "#F59E0B"} 
                  />
                  <Text 
                    style={[
                      styles.verificationText,
                      { color: securityInfo.email_verified ? "#10B981" : "#F59E0B" }
                    ]}
                  >
                    {securityInfo.email_verified ? "Verified" : "Not Verified"}
                  </Text>
                </View>
                
                {!securityInfo.email_verified && (
                  <TouchableOpacity style={styles.verifyButton}>
                    <Text style={styles.verifyButtonText}>Verify Email</Text>
                  </TouchableOpacity>
                )}
              </View>
              
              <View style={styles.divider} />
              
              <Text style={styles.securitySubtitle}>Change Password</Text>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Current Password</Text>
                <TextInput
                  style={styles.input}
                  value={securityInfo.current_password}
                  onChangeText={(text) => setSecurityInfo({...securityInfo, current_password: text})}
                  placeholder="Enter your current password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry
                />
              </View>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>New Password</Text>
                <TextInput
                  style={styles.input}
                  value={securityInfo.new_password}
                  onChangeText={(text) => setSecurityInfo({...securityInfo, new_password: text})}
                  placeholder="Enter new password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry
                />
              </View>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>Confirm New Password</Text>
                <TextInput
                  style={styles.input}
                  value={securityInfo.confirm_password}
                  onChangeText={(text) => setSecurityInfo({...securityInfo, confirm_password: text})}
                  placeholder="Confirm new password"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry
                />
              </View>
              
              <TouchableOpacity 
                style={styles.saveButton}
                onPress={handleUpdatePassword}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.saveButtonText}>Update Password</Text>
                )}
              </TouchableOpacity>
              
              <View style={styles.divider} />
              
              <Text style={styles.securitySubtitle}>Two-Factor Authentication</Text>
              
              <View style={styles.formGroup}>
                <View style={styles.switchContainer}>
                  <Text style={styles.switchLabel}>Enable Two-Factor Authentication</Text>
                  <Switch
                    trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
                    thumbColor="#FFFFFF"
                    ios_backgroundColor="#D1D5DB"
                    value={false}
                    disabled={true}
                  />
                </View>
                <Text style={styles.helperText}>Coming soon</Text>
              </View>
              
              <View style={styles.divider} />
              
              <Text style={styles.securitySubtitle}>Connected Accounts</Text>
              
              <View style={styles.connectedAccount}>
                <View style={styles.accountInfo}>
                  <Ionicons name="logo-google" size={20} color="#DB4437" />
                  <Text style={styles.accountName}>Google</Text>
                </View>
                <TouchableOpacity style={styles.connectButton}>
                  <Text style={styles.connectButtonText}>Connect</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
        
      // Notifications Tab
      case 'notifications':
        return (
          <View style={styles.tabContent}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Email Notifications</Text>
              
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={styles.settingTitle}>Email Notifications</Text>
                  <Text style={styles.settingDescription}>Enable all email notifications</Text>
                </View>
                <Switch
                  trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#D1D5DB"
                  onValueChange={(value) => 
                    setNotificationSettings({...notificationSettings, email_notifications: value})
                  }
                  value={notificationSettings.email_notifications}
                />
              </View>
              
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={styles.settingTitle}>New Expenses</Text>
                  <Text style={styles.settingDescription}>When someone adds a new expense</Text>
                </View>
                <Switch
                  trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#D1D5DB"
                  disabled={!notificationSettings.email_notifications}
                  onValueChange={(value) => 
                    setNotificationSettings({...notificationSettings, expense_added: value})
                  }
                  value={notificationSettings.email_notifications && notificationSettings.expense_added}
                />
              </View>
              
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={styles.settingTitle}>Expense Updates</Text>
                  <Text style={styles.settingDescription}>When an expense is modified or updated</Text>
                </View>
                <Switch
                  trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#D1D5DB"
                  disabled={!notificationSettings.email_notifications}
                  onValueChange={(value) => 
                    setNotificationSettings({...notificationSettings, expense_updated: value})
                  }
                  value={notificationSettings.email_notifications && notificationSettings.expense_updated}
                />
              </View>
              
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={styles.settingTitle}>Payment Reminders</Text>
                  <Text style={styles.settingDescription}>Reminders about pending payments</Text>
                </View>
                <Switch
                  trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#D1D5DB"
                  disabled={!notificationSettings.email_notifications}
                  onValueChange={(value) => 
                    setNotificationSettings({...notificationSettings, payment_reminder: value})
                  }
                  value={notificationSettings.email_notifications && notificationSettings.payment_reminder}
                />
              </View>
              
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={styles.settingTitle}>Monthly Summary</Text>
                  <Text style={styles.settingDescription}>Monthly expense summary report</Text>
                </View>
                <Switch
                  trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#D1D5DB"
                  disabled={!notificationSettings.email_notifications}
                  onValueChange={(value) => 
                    setNotificationSettings({...notificationSettings, monthly_summary: value})
                  }
                  value={notificationSettings.email_notifications && notificationSettings.monthly_summary}
                />
              </View>
            </View>
            
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Push Notifications</Text>
              
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={styles.settingTitle}>Push Notifications</Text>
                  <Text style={styles.settingDescription}>Enable mobile push notifications</Text>
                </View>
                <Switch
                  trackColor={{ false: "#D1D5DB", true: "#3B82F6" }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#D1D5DB"
                  onValueChange={(value) => 
                    setNotificationSettings({...notificationSettings, push_notifications: value})
                  }
                  value={notificationSettings.push_notifications}
                />
              </View>
              
              <TouchableOpacity 
                style={styles.saveButton}
                onPress={handleUpdateNotifications}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Notification Preferences</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        );
        
      // Groups Tab
      case 'groups':
        return (
          <View style={styles.tabContent}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your Groups</Text>
              
              {loadingGroups ? (
                <ActivityIndicator color="#3B82F6" style={{ marginVertical: 20 }} />
              ) : groups.length > 0 ? (
                groups.map((membership) => (
                  <View key={membership.group_id} style={styles.groupCard}>
                    <View style={styles.groupInfo}>
                      <Text style={styles.groupName}>{membership.groups.name}</Text>
                      <View style={styles.roleChip}>
                        <Text style={styles.roleText}>{membership.role.toUpperCase()}</Text>
                      </View>
                    </View>
                    
                    <Text style={styles.homeAddress}>
                      {membership.groups.homes?.name ? 
                        `${membership.groups.homes.name} - ${membership.groups.homes.address}` : 
                        'No home assigned'
                      }
                    </Text>
                    
                    {membership.groups.description && (
                      <Text style={styles.groupDescription}>
                        {membership.groups.description}
                      </Text>
                    )}
                    
                    <Text style={styles.joinDate}>
                      Joined {new Date(membership.joined_at).toLocaleDateString()}
                    </Text>
                    
                    <View style={styles.groupActions}>
                      <TouchableOpacity 
                        style={styles.viewGroupButton}
                        onPress={() => Alert.alert('Coming Soon', 'View group details will be available soon.')}
                      >
                        <Text style={styles.viewGroupText}>View Details</Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity 
                        style={styles.leaveGroupButton}
                        onPress={() => handleLeaveGroup(membership.group_id, membership.groups.name)}
                      >
                        <Text style={styles.leaveGroupText}>Leave Group</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={48} color="#9CA3AF" />
                  <Text style={styles.emptyStateTitle}>No Groups Found</Text>
                  <Text style={styles.emptyStateText}>
                    You haven't joined any household groups yet.
                  </Text>
                  <TouchableOpacity 
                    style={styles.createButton}
                    onPress={() => Alert.alert('Coming Soon', 'Group creation will be available soon.')}
                  >
                    <Text style={styles.createButtonText}>Create or Join a Group</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        );
        
      default:
        return null;
    }
  };

  if (!userProfile && !currentUser) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
          {activeTab === 'personal' && (
            <TouchableOpacity 
              style={styles.editButton}
              onPress={() => setIsEditing(!isEditing)}
            >
              <Text style={styles.editButtonText}>
                {isEditing ? 'Cancel' : 'Edit'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            {personalInfo.avatar_url ? (
              <Image 
                source={{ uri: personalInfo.avatar_url }} 
                style={styles.avatar} 
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>
                  {personalInfo.full_name?.charAt(0) || personalInfo.email?.charAt(0) || '?'}
                </Text>
              </View>
            )}
            
            {isEditing && (
              <TouchableOpacity style={styles.changeAvatarButton}>
                <Ionicons name="camera-outline" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>
          
          <Text style={styles.profileName}>
            {personalInfo.full_name || 'Anonymous User'}
          </Text>
          <Text style={styles.profileEmail}>{personalInfo.email || 'No email'}</Text>
          
          {userProfile?.created_at && (
            <Text style={styles.joinDate}>
              Member since {new Date(userProfile.created_at).toLocaleDateString()}
            </Text>
          )}
        </View>

        <View style={styles.tabBar}>
          <TouchableOpacity 
            style={[styles.tabItem, activeTab === 'personal' && styles.activeTab]}
            onPress={() => setActiveTab('personal')}
          >
            <Text style={[styles.tabText, activeTab === 'personal' && styles.activeTabText]}>Personal</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.tabItem, activeTab === 'security' && styles.activeTab]}
            onPress={() => setActiveTab('security')}
          >
            <Text style={[styles.tabText, activeTab === 'security' && styles.activeTabText]}>Security</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.tabItem, activeTab === 'notifications' && styles.activeTab]}
            onPress={() => setActiveTab('notifications')}
          >
            <Text style={[styles.tabText, activeTab === 'notifications' && styles.activeTabText]}>Notifications</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.tabItem, activeTab === 'groups' && styles.activeTab]}
            onPress={() => setActiveTab('groups')}
          >
            <Text style={[styles.tabText, activeTab === 'groups' && styles.activeTabText]}>Groups</Text>
          </TouchableOpacity>
        </View>

        <ScrollView 
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.contentContainer}
        >
          {renderTabContent()}
          
          <View style={styles.actionsContainer}>
            <TouchableOpacity 
              style={styles.logoutButton}
              onPress={handleLogout}
            >
              <Ionicons name="log-out-outline" size={20} color="#FFFFFF" style={styles.buttonIcon} />
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.dangerButton}
              onPress={handleDeleteAccount}
            >
              <Text style={styles.dangerButtonText}>Delete Account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B7280',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  editButton: {
    padding: 8,
  },
  editButtonText: {
    color: '#3B82F6',
    fontSize: 16,
    fontWeight: '500',
  },
  profileHeader: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#E5E7EB',
  },
  avatarFallback: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  changeAvatarButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  profileName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 8,
  },
  joinDate: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#3B82F6',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  activeTabText: {
    color: '#3B82F6',
  },
  scrollContent: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 40,
  },
  tabContent: {
    paddingTop: 16,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 8,
  },
  securitySubtitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1F2937',
    marginBottom: 12,
    marginTop: 4,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4B5563',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  value: {
    fontSize: 16,
    color: '#1F2937',
  },
  verificationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  verificationText: {
    fontSize: 14,
    marginLeft: 4,
  },
  verifyButton: {
    marginTop: 12,
    backgroundColor: '#F59E0B',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  verifyButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
  },
  radioGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  radioOption: {
    padding: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#F9FAFB',
  },
  radioOptionSelected: {
    borderColor: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  radioText: {
    fontSize: 14,
    color: '#4B5563',
  },
  radioTextSelected: {
    color: '#3B82F6',
    fontWeight: '500',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1F2937',
  },
  settingDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1F2937',
    flex: 1,
  },
  helperText: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
    fontStyle: 'italic',
  },
  connectedAccount: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  accountInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accountName: {
    fontSize: 16,
    marginLeft: 10,
    color: '#1F2937',
  },
  connectButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#3B82F6',
  },
  connectButtonText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  groupCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
  },
  groupInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  groupName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
  },
  roleChip: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  roleText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#3B82F6',
  },
  homeAddress: {
    fontSize: 14,
    color: '#4B5563',
    marginBottom: 4,
  },
  groupDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
    marginBottom: 8,
  },
  joinDate: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 12,
  },
  groupActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  viewGroupButton: {
    flex: 1,
    marginRight: 8,
    padding: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
  },
  viewGroupText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3B82F6',
  },
  leaveGroupButton: {
    flex: 1,
    marginLeft: 8,
    padding: 10,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  leaveGroupText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#EF4444',
  },
  emptyState: {
    alignItems: 'center',
    padding: 20,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 12,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 16,
  },
  createButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  actionsContainer: {
    padding: 16,
  },
  saveButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    marginTop: 16,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  logoutButton: {
    backgroundColor: '#4B5563',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  logoutButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonIcon: {
    marginRight: 8,
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default ProfileScreen;
