import React, { createContext, useContext, useState, useEffect } from 'react';
import { Alert, Text } from 'react-native';
import { supabase } from '../utils/supabaseClient';

// Create the auth context
const AuthContext = createContext(null);

// Custom hook to use the auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Auth Provider component
export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check for user session on initial load
  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          setCurrentUser(session.user);
          
          // Fetch user profile details
          const { data, error } = await supabase
            .from('profiles')
            .select()
            .eq('id', session.user.id)
            .single();
            
          if (data && !error) {
            setUserProfile(data);
          }
        }
      } catch (error) {
        console.error('Session check error:', error);
      } finally {
        setLoading(false);
      }
    };
    
    checkUser();
    
    // Set up auth state change subscription
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setCurrentUser(session?.user || null);
        
        if (session?.user) {
          // Fetch profile on auth state change
          const { data } = await supabase
            .from('profiles')
            .select()
            .eq('id', session.user.id)
            .single();
            
          setUserProfile(data || null);
        } else {
          setUserProfile(null);
        }
      }
    );
    
    // Clean up subscription
    return () => {
      if (authListener && authListener.subscription) {
        authListener.subscription.unsubscribe();
      }
    };
  }, []);
  
  // Mock data for development
  useEffect(() => {
    if (!currentUser && !loading) {
      // For development only: provide mock data
      const mockUser = { id: 'dev-user-id', email: 'dev@example.com' };
      const mockProfile = { id: 'dev-user-id', full_name: 'Development User' };
      
      // Uncomment these lines to enable mock data in development
      // setCurrentUser(mockUser);
      // setUserProfile(mockProfile);
    }
  }, [currentUser, loading]);

  const value = {
    currentUser,
    userProfile,
    loading,
    
    // Add auth methods here
    signIn: async (email, password) => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email, password
        });
        if (error) throw error;
        return { success: true, user: data.user };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    
    signOut: async () => {
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {loading ? <Text>Loading...</Text> : children} {/* Wrap plain text in <Text> */}
    </AuthContext.Provider>
  );
};