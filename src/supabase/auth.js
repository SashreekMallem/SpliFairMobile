import { supabase } from './config';

// Sign up with email and password
export const signUp = async (email, password, fullName) => {
  try {
    // Register the user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        }
      }
    });

    if (authError) throw authError;

    // Create a profile record in the profiles table
    if (authData.user) {
      // Check if a profile already exists
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', authData.user.id)
        .single();
        
      // Only insert if no profile exists
      if (!existingProfile) {
        const { error: profileError } = await supabase
          .from('profiles')
          .insert([
            { 
              id: authData.user.id,
              full_name: fullName,
              email,
              created_at: new Date().toISOString(),
            }
          ]);

        if (profileError) {
          console.error('Error creating profile:', profileError);
          // Continue with authentication despite profile error
        }
      }
    }

    return { success: true, user: authData.user };
  } catch (error) {
    console.error('Error signing up:', error.message);
    return { success: false, error: error.message };
  }
};

// Sign in with email and password
export const signIn = async (email, password) => {
  try {
    // Check Supabase connection first
    if (!supabase || !supabase.auth) {
      console.error('Supabase client not properly initialized');
      return { 
        success: false, 
        error: 'Authentication service not available. Please try again later.'
      };
    }
    
    console.log('Attempting Supabase sign in');
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Supabase auth error:', error);
      throw error;
    }
    
    console.log('Sign in successful');
    return { success: true, user: data.user, session: data.session };
  } catch (error) {
    console.error('Error signing in:', error);
    
    // Provide more user-friendly error messages
    let errorMessage = 'Failed to sign in. Please try again.';
    if (error.message) {
      if (error.message.includes('Invalid login credentials')) {
        errorMessage = 'Invalid email or password. Please try again.';
      } else if (error.message.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      }
    }
    
    return { success: false, error: errorMessage };
  }
};

// Sign in with Google
export const signInWithGoogle = async () => {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error signing in with Google:', error.message);
    return { success: false, error: error.message };
  }
};

// Sign out
export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error signing out:', error.message);
    return { success: false, error: error.message };
  }
};

// Reset password
export const resetPassword = async (email) => {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    });
    
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error resetting password:', error.message);
    return { success: false, error: error.message };
  }
};

// Get the current user
export const getCurrentUser = async () => {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return { success: true, user: data.user };
  } catch (error) {
    console.error('Error getting current user:', error.message);
    return { success: false, error: error.message };
  }
};

// Get user profile
export const getUserProfile = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return { success: true, profile: data };
  } catch (error) {
    console.error('Error getting user profile:', error.message);
    return { success: false, error: error.message };
  }
};

// Make sure profile is created when user signs in
export const ensureUserProfile = async (user) => {
  if (!user || !user.id) {
    console.error('Cannot ensure profile: invalid user data', user);
    return { success: false, error: 'Invalid user data' };
  }
  
  try {
    console.log('Ensuring profile exists for user:', user.id);
    
    // Check if profile exists
    const { data: existingProfile, error: checkError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
      
    if (checkError && checkError.code !== 'PGRST116') {  // PGRST116 is 'not found'
      console.error('Error checking profile existence:', checkError);
      throw checkError;
    }
    
    if (existingProfile) {
      console.log('Profile already exists:', existingProfile.id);
      return { success: true, profile: existingProfile };
    }
    
    console.log('Profile not found, creating new profile');
    
    // Create profile if it doesn't exist
    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert([{
        id: user.id,
        full_name: user.user_metadata?.full_name || user.user_metadata?.name || 'User',
        email: user.email,
        avatar_url: user.user_metadata?.avatar_url,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();
      
    if (insertError) {
      console.error('Error creating user profile:', insertError);
      throw insertError;
    }
    
    console.log('Profile created successfully:', newProfile.id);
    return { success: true, profile: newProfile };
  } catch (error) {
    console.error('Error ensuring user profile exists:', error);
    return { success: false, error: error.message };
  }
};
