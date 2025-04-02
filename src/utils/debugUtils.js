/**
 * Debug utilities to help identify "large" string to float conversion errors
 */

// List of style properties that expect numeric values
const NUMERIC_STYLE_PROPS = [
  'width', 'height', 'top', 'left', 'right', 'bottom',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'marginHorizontal', 'marginVertical', 'padding', 'paddingTop',
  'paddingRight', 'paddingBottom', 'paddingLeft', 'paddingHorizontal',
  'paddingVertical', 'borderWidth', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'fontSize', 'lineHeight', 'flexGrow',
  'flexShrink', 'flex', 'zIndex', 'opacity', 'borderRadius', 'shadowRadius',
  'elevation', 'maxWidth', 'maxHeight', 'minWidth', 'minHeight'
];

/**
 * Initialize debug utilities to track "large" string usage in styles
 */
export const initDebugUtils = () => {
  console.log('📋 Initializing debug utilities to find "large" string...');
  
  // Keep track of objects being monitored to prevent infinite recursion
  const monitoredObjects = new WeakSet();
  
  // Original console.error to restore later
  const originalError = console.error;
  
  // Override console.error to catch specific errors
  console.error = function(...args) {
    const errorMsg = args.join(' ');
    
    if (errorMsg.includes('Unable to convert string to floating point value: "large"')) {
      console.warn('🔍 DETECTED "large" STRING ERROR!');
      console.warn('Stack trace:', new Error().stack);
    }
    
    return originalError.apply(this, args);
  };
  
  // Monkey patch StyleSheet.create to inspect styles
  if (global.ReactNative && global.ReactNative.StyleSheet) {
    const originalCreate = global.ReactNative.StyleSheet.create;
    
    global.ReactNative.StyleSheet.create = function(styles) {
      inspectObject(styles, 'StyleSheet.create');
      return originalCreate(styles);
    };
  }
  
  // Helper function to deeply inspect an object for "large" string
  function inspectObject(obj, path = 'root') {
    if (!obj || typeof obj !== 'object' || monitoredObjects.has(obj)) {
      return;
    }
    
    monitoredObjects.add(obj);
    
    Object.entries(obj).forEach(([key, value]) => {
      const currentPath = `${path}.${key}`;
      
      if (value === 'large') {
        if (NUMERIC_STYLE_PROPS.includes(key)) {
          console.warn(`🚨 Found "large" string in numeric property: ${currentPath}`);
          console.warn('Stack trace:', new Error().stack);
        } else {
          console.log(`📝 Note: "large" string found in non-numeric property: ${currentPath}`);
        }
      } else if (typeof value === 'object' && value !== null) {
        inspectObject(value, currentPath);
      }
    });
  }
  
  // Monitor global screenOptions in React Navigation
  if (global.__REACT_NAVIGATION__) {
    console.log('📊 Monitoring React Navigation screenOptions...');
    
    const originalUseScreenOptions = global.__REACT_NAVIGATION__.useScreenOptions;
    if (originalUseScreenOptions) {
      global.__REACT_NAVIGATION__.useScreenOptions = function(...args) {
        const options = originalUseScreenOptions.apply(this, args);
        inspectObject(options, 'screenOptions');
        return options;
      };
    }
  }
  
  // Return function to restore original functions
  return () => {
    console.error = originalError;
    if (global.ReactNative && global.ReactNative.StyleSheet) {
      global.ReactNative.StyleSheet.create = originalCreate;
    }
    console.log('🧹 Debug utils cleanup complete');
  };
};
