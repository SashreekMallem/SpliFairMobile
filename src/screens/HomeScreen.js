import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');
const cardWidth = width * 0.42;

const HomeScreen = ({ navigation }) => {
  const auth = useAuth(); // Get the entire auth object first
  const currentUser = auth?.currentUser || null; // Then safely access properties
  const userProfile = auth?.userProfile || null;
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalExpenses: 0,
    yourBalance: 0,
    pendingPayments: 0,
    upcomingExpenses: 0
  });
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [quickActions, setQuickActions] = useState([]);

  useEffect(() => {
    // Load initial data
    loadHomeData();
  }, []);

  const loadHomeData = async () => {
    setLoading(true);
    try {
      // In a real app, fetch this data from your API/backend
      // For now, using mock data
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setSummary({
        totalExpenses: 742.50,
        yourBalance: 125.75,
        pendingPayments: 64.25,
        upcomingExpenses: 215.00
      });
      
      setRecentTransactions([
        {
          id: 1,
          description: 'Grocery Shopping',
          date: '2023-05-28',
          amount: 85.75,
          category: 'food',
          participants: ['You', 'Emma', 'Michael']
        },
        {
          id: 2,
          description: 'Internet Bill',
          date: '2023-05-25',
          amount: 59.99,
          category: 'utilities',
          participants: ['All Roommates']
        },
        {
          id: 3,
          description: 'Netflix Subscription',
          date: '2023-05-20',
          amount: 14.99,
          category: 'entertainment',
          participants: ['All Roommates']
        }
      ]);
      
      setQuickActions([
        { id: 'add_expense', title: 'Add Expense', icon: 'add-circle', color: '#3B82F6' },
        { id: 'settle_up', title: 'Settle Up', icon: 'cash', color: '#10B981' },
        { id: 'check_rules', title: 'House Rules', icon: 'list', color: '#6366F1' },
        { id: 'view_schedule', title: 'Schedule', icon: 'calendar', color: '#F59E0B' }
      ]);
    } catch (error) {
      console.error('Error loading home data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHomeData();
    setRefreshing(false);
  };

  const formatCurrency = (amount) => {
    return `$${amount.toFixed(2)}`;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleQuickAction = (actionId) => {
    switch (actionId) {
      case 'add_expense':
        navigation.navigate('Expenses');
        break;
      case 'settle_up':
        navigation.navigate('Expenses');
        break;
      case 'check_rules':
        // Navigate to House Rules screen
        break;
      case 'view_schedule':
        // Navigate to Schedule screen
        break;
      default:
        break;
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'food':
        return 'fast-food';
      case 'utilities':
        return 'flash';
      case 'rent':
        return 'home';
      case 'entertainment':
        return 'film';
      default:
        return 'cart';
    }
  };

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading home data...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            Hello, {userProfile?.full_name || 'there'}!
          </Text>
          <Text style={styles.subGreeting}>Welcome back to SpliFair</Text>
        </View>
        <TouchableOpacity 
          style={styles.profileButton} 
          onPress={() => navigation.navigate('ProfileScreen')} // Ensure the name matches the registered screen
        >
          <Ionicons name="person-circle" size={40} color="#3B82F6" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.summaryContainer}>
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, styles.primaryCard]}>
              <Text style={styles.summaryLabel}>Your Balance</Text>
              <Text style={styles.summaryValue}>
                {formatCurrency(summary.yourBalance)}
              </Text>
              <Text style={styles.summaryNote}>
                {summary.yourBalance >= 0 ? 'You are owed' : 'You owe'}
              </Text>
            </View>
            
            <View style={[styles.summaryCard, styles.secondaryCard]}>
              <Text style={styles.summaryLabel}>Pending Payments</Text>
              <Text style={styles.summaryValue}>
                {formatCurrency(summary.pendingPayments)}
              </Text>
              <Text style={styles.summaryNote}>To be settled</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <FlatList
          data={quickActions}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.quickActionsContainer}
          renderItem={({item}) => (
            <TouchableOpacity 
              style={styles.quickActionButton}
              onPress={() => handleQuickAction(item.id)}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: item.color + '20' }]}>
                <Ionicons name={item.icon} size={24} color={item.color} />
              </View>
              <Text style={styles.quickActionText}>{item.title}</Text>
            </TouchableOpacity>
          )}
        />

        <View style={styles.transactionsHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Expenses')}>
            <Text style={styles.viewAllLink}>View All</Text>
          </TouchableOpacity>
        </View>

        {recentTransactions.map(transaction => (
          <View key={transaction.id} style={styles.transactionCard}>
            <View style={styles.transactionIconContainer}>
              <Ionicons 
                name={getCategoryIcon(transaction.category)} 
                size={24} 
                color="#3B82F6" 
              />
            </View>
            <View style={styles.transactionDetails}>
              <Text style={styles.transactionTitle}>{transaction.description}</Text>
              <Text style={styles.transactionParticipants}>
                {transaction.participants.join(', ')}
              </Text>
              <Text style={styles.transactionDate}>{formatDate(transaction.date)}</Text>
            </View>
            <View style={styles.transactionAmount}>
              <Text style={styles.transactionAmountText}>
                {formatCurrency(transaction.amount)}
              </Text>
            </View>
          </View>
        ))}

        <View style={styles.emptySpace} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  subGreeting: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 8,
  },
  summaryContainer: {
    marginBottom: 24,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryCard: {
    width: '48%',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  primaryCard: {
    backgroundColor: '#3B82F6',
  },
  secondaryCard: {
    backgroundColor: '#FFFFFF',
  },
  summaryLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  summaryNote: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  secondaryCard: {
    backgroundColor: '#FFFFFF',
  },
  summaryLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  secondaryCard: {
    backgroundColor: '#FFFFFF',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 16,
  },
  quickActionsContainer: {
    paddingBottom: 16,
  },
  quickActionButton: {
    alignItems: 'center',
    marginRight: 24,
  },
  quickActionIcon: {
    width: 60,
    height: 60,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickActionText: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
  },
  transactionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  viewAllLink: {
    fontSize: 14,
    color: '#3B82F6',
    fontWeight: '500',
  },
  transactionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  transactionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  transactionDetails: {
    flex: 1,
  },
  transactionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1F2937',
    marginBottom: 4,
  },
  transactionParticipants: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 2,
  },
  transactionDate: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  transactionAmount: {
    alignItems: 'flex-end',
  },
  transactionAmountText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  emptySpace: {
    height: 20,
  },
});

export default HomeScreen;
