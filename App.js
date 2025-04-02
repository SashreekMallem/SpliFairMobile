import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LogBox } from 'react-native';
import { AuthProvider } from './src/context/AuthContext'; // Add this import

// Suppress "topInsetsChange" error
LogBox.ignoreLogs([
  'Unsupported top level event type "topInsetsChange" dispatched',
  'Non-serializable values were found',
  'VirtualizedLists should never be nested'
]);

// Import screens
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import MainTabNavigator from './src/navigation/MainTabNavigator';

const Stack = createStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider> {/* Add AuthProvider here */}
        <NavigationContainer>
          <Stack.Navigator 
            screenOptions={{
              headerShown: false,
              cardStyle: { backgroundColor: '#F3F4F6' }
            }}
          >
            <Stack.Screen name="MainTabs" component={MainTabNavigator} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
