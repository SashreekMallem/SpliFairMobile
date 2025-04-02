/**
 * This file contains patches for react-navigation-screens
 * to fix the "Unable to convert string to floating point value: 'large'" error
 */

// Store original Screen styling methods
let originalGetters = {};

export const patchScreensLibrary = () => {
  try {
    // Import screens package dynamically to avoid affecting the import order
    const Screens = require('react-native-screens');
    
    console.log('🔧 Patching react-native-screens to prevent "large" string values...');
    
    // Get the Screen component
    const ScreenComponent = Screens.Screen;
    
    if (!ScreenComponent || !ScreenComponent.render) {
      console.log('⚠️ Could not find Screen.render to patch');
      return;
    }
    
    // Check if the component has already been patched
    if (ScreenComponent._patched) {
      console.log('✅ Screen component already patched');
      return;
    }
    
    // Find the contentInset property descriptor in the prototype chain
    const screenPrototype = Object.getPrototypeOf(ScreenComponent);
    if (!screenPrototype) {
      console.log('⚠️ Could not find Screen prototype');
      return;
    }
    
    // Force numeric values in object properties that might contain "large"
    const patchScreenProps = (props) => {
      if (!props) return props;
      
      // Create a clean copy to avoid modifying the original
      const patchedProps = {...props};
      
      // Replace problematic values
      if (patchedProps.largeTitle === 'large') {
        patchedProps.largeTitle = false;
      }
      
      if (patchedProps.largeTitleFontSize === 'large') {
        patchedProps.largeTitleFontSize = 34;
      }
      
      if (patchedProps.contentInset === 'large') {
        patchedProps.contentInset = 44;
      }
      
      if (patchedProps.style && typeof patchedProps.style === 'object') {
        // Check for style properties
        if (patchedProps.style.fontSize === 'large') {
          patchedProps.style.fontSize = 34;
        }
        if (patchedProps.style.height === 'large') {
          patchedProps.style.height = 100;
        }
      }
      
      return patchedProps;
    };
    
    // Patch the render method 
    const originalRender = ScreenComponent.render;
    ScreenComponent.render = function(props, ref) {
      const patchedProps = patchScreenProps(props);
      return originalRender.call(this, patchedProps, ref);
    };
    
    // Mark as patched
    ScreenComponent._patched = true;
    
    console.log('✅ Successfully patched react-native-screens');
    
    return true;
  } catch (error) {
    console.error('⚠️ Failed to patch react-native-screens:', error);
    return false;
  }
};
