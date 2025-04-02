import { createClient } from '@supabase/supabase-js';

// Replace these with your actual values from Supabase dashboard > Settings > API
const supabaseUrl = 'https://zomrjndmcuqsqmktbjdy.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvbXJqbmRtY3Vxc3Fta3RiamR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI0NDI2MjksImV4cCI6MjA1ODAxODYyOX0.oDK7ikO-gqe80D6C04FYk2A4ZqZ81CXe-8HBIsfdc64';

// Add error handling to detect missing credentials
if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your-actual-project-id')) {
  console.error('⚠️ Supabase credentials not configured! Please add your Supabase URL and anon key.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// For development, test the connection
supabase.auth.getSession().then(({ data, error }) => {
  if (error) {
    console.error('❌ Supabase connection error:', error.message);
  } else {
    console.log('✅ Supabase connection established');
  }
});
