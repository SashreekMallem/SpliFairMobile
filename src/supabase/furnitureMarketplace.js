import { supabase } from './config';

/**
 * Create a new furniture listing
 * @param {Object} listingData - The listing data
 * @param {string} userId - The user ID of the seller
 * @param {Array} imageFiles - Array of image files to upload
 * @param {Object} listingTypes - Object containing boolean flags for listing types (sell, rent, swap)
 */
export const createFurnitureListing = async (listingData, userId, imageFiles = [], listingTypes = {}) => {
  try {
    // Start a transaction by creating the base listing
    const { data: listing, error: listingError } = await supabase
      .from('furniture_listings')
      .insert({
        user_id: userId,
        title: listingData.title,
        description: listingData.description,
        condition: listingData.condition,
        category: listingData.category,
        created_at: new Date(),
        updated_at: new Date(),
        is_active: true,
        is_sanitized: listingData.offerSanitization || false,
        includes_delivery: listingData.includeDelivery || false,
        is_featured: listingData.featureListing || false,
        location: listingData.location,
      })
      .select()
      .single();

    if (listingError) {
      console.error('Error creating listing:', listingError);
      return { success: false, error: listingError.message };
    }

    // Upload images if provided
    const imageUrls = await uploadListingImages(listing.id, imageFiles);
    
    // Update listing with primary image
    if (imageUrls.length > 0) {
      await supabase
        .from('furniture_listings')
        .update({ primary_image: imageUrls[0] })
        .eq('id', listing.id);
    }

    // Create listing type records based on the listingTypes object
    if (listingTypes.sell) {
      const { error: sellError } = await supabase
        .from('furniture_listing_sales')
        .insert({
          listing_id: listing.id,
          price: listingData.salePrice,
        });

      if (sellError) {
        console.error('Error creating sale details:', sellError);
        return { success: false, error: sellError.message };
      }
    }

    if (listingTypes.rent) {
      const { error: rentError } = await supabase
        .from('furniture_listing_rentals')
        .insert({
          listing_id: listing.id,
          price_per_month: listingData.rentalPrice,
          security_deposit: listingData.securityDeposit,
          minimum_rental_months: listingData.minimumRental,
          rent_to_own_available: listingData.rentToOwn || false,
          rent_to_own_price: listingData.rentToOwnPrice,
          rent_to_own_months: listingData.rentToOwnMonths,
        });

      if (rentError) {
        console.error('Error creating rental details:', rentError);
        return { success: false, error: rentError.message };
      }
    }

    if (listingTypes.swap) {
      const { error: swapError } = await supabase
        .from('furniture_listing_swaps')
        .insert({
          listing_id: listing.id,
          looking_for: listingData.lookingFor,
        });

      if (swapError) {
        console.error('Error creating swap details:', swapError);
        return { success: false, error: swapError.message };
      }
    }

    // Store all additional images
    if (imageUrls.length > 1) {
      const additionalImages = imageUrls.slice(1).map(url => ({
        listing_id: listing.id,
        image_url: url
      }));

      const { error: imagesError } = await supabase
        .from('furniture_listing_images')
        .insert(additionalImages);

      if (imagesError) {
        console.error('Error storing additional images:', imagesError);
      }
    }

    return {
      success: true,
      listing: {
        ...listing,
        imageUrls,
        listingTypes
      }
    };
  } catch (error) {
    console.error('Unexpected error creating listing:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Upload images for a listing
 * @param {string} listingId - The listing ID
 * @param {Array} imageFiles - Array of image files to upload
 * @returns {Promise<Array>} - Array of image URLs
 */
const uploadListingImages = async (listingId, imageFiles) => {
  const imageUrls = [];

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    const fileExt = file.name.split('.').pop();
    const fileName = `${listingId}/${i}-${Date.now()}.${fileExt}`;
    const filePath = `furniture_listings/${fileName}`;

    const { error: uploadError, data } = await supabase.storage
      .from('listings')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Error uploading image:', uploadError);
      continue;
    }

    const { data: urlData } = supabase.storage
      .from('listings')
      .getPublicUrl(filePath);

    if (urlData && urlData.publicUrl) {
      imageUrls.push(urlData.publicUrl);
    }
  }

  return imageUrls;
};

/**
 * Get all listings with optional filtering
 * @param {Object} filters - Filter options 
 * @param {string} sortBy - Sort field
 * @param {string} sortOrder - Sort order ('asc' or 'desc')
 * @param {number} page - Page number
 * @param {number} limit - Number of items per page
 */
export const getListings = async (filters = {}, sortBy = 'created_at', sortOrder = 'desc', page = 1, limit = 10) => {
  try {
    // Build the query without the problematic join
    let query = supabase
      .from('furniture_listings')
      .select(`
        *,
        furniture_listing_sales(*),
        furniture_listing_rentals(*),
        furniture_listing_swaps(*),
        furniture_listing_images(*)
      `)
      .eq('is_active', true);

    // Apply category filter
    if (filters.category) {
      query = query.eq('category', filters.category);
    }

    // Apply condition filter
    if (filters.condition) {
      query = query.eq('condition', filters.condition);
    }

    // Apply price range filter for sale items
    if (filters.minPrice || filters.maxPrice) {
      query = query.or(`furniture_listing_sales.price.gte.${filters.minPrice || 0},furniture_listing_rentals.price_per_month.gte.${filters.minPrice || 0}`);
      
      if (filters.maxPrice) {
        query = query.or(`furniture_listing_sales.price.lte.${filters.maxPrice},furniture_listing_rentals.price_per_month.lte.${filters.maxPrice}`);
      }
    }

    // Apply listing type filter
    if (filters.listingType) {
      if (filters.listingType === 'sale') {
        query = query.not('furniture_listing_sales', 'is', null);
      } else if (filters.listingType === 'rental') {
        query = query.not('furniture_listing_rentals', 'is', null);
      } else if (filters.listingType === 'swap') {
        query = query.not('furniture_listing_swaps', 'is', null);
      }
    }

    // Apply search term filter
    if (filters.searchTerm) {
      query = query.or(`title.ilike.%${filters.searchTerm}%,description.ilike.%${filters.searchTerm}%`);
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching listings:', error);
      return { success: false, error: error.message };
    }

    // If we need user information, fetch it separately for each listing
    if (data && data.length > 0) {
      // Get unique user IDs from the listings
      const userIds = [...new Set(data.map(item => item.user_id))];
      
      // Fetch user information for these IDs
      if (userIds.length > 0) {
        const { data: userData, error: userError } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, created_at, phone')
          .in('id', userIds);
        
        if (!userError && userData) {
          // Create a map of user data for quick lookup
          const userMap = {};
          userData.forEach(user => {
            userMap[user.id] = user;
          });
          
          // Add seller information to each listing
          data.forEach(listing => {
            const profileData = userMap[listing.user_id];
            listing.seller = profileData ? {
              id: profileData.id,
              full_name: profileData.full_name,
              avatar_url: profileData.avatar_url,
              rating: 4.5  // This is hardcoded for now, you might want to calculate this from real data later
            } : {
              full_name: 'Unknown User',
              avatar_url: null,
              rating: 0
            };
          });
        }
      }
    }

    return {
      success: true,
      listings: data,
      count: count || data.length,
      page,
      limit,
      totalPages: Math.ceil((count || data.length) / limit)
    };
  } catch (error) {
    console.error('Unexpected error fetching listings:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get listings available for rent
 * @param {Object} filters - Filter options 
 * @param {string} sortBy - Sort field
 * @param {string} sortOrder - Sort order ('asc' or 'desc')
 * @param {number} page - Page number
 * @param {number} limit - Number of items per page
 */
export const getRentalListings = async (filters = {}, sortBy = 'price_per_month', sortOrder = 'asc', page = 1, limit = 10) => {
  try {
    // Build the query to get all listings with rental options
    let query = supabase
      .from('furniture_listings')
      .select(`
        *,
        furniture_listing_rentals(*),
        furniture_listing_images(*)
      `)
      .eq('is_active', true)
      .not('furniture_listing_rentals', 'is', null);  // Only get listings with rental information

    // Apply price range filter for rental items
    if (filters.minPrice) {
      query = query.gte('furniture_listing_rentals.price_per_month', filters.minPrice);
    }
    
    if (filters.maxPrice) {
      query = query.lte('furniture_listing_rentals.price_per_month', filters.maxPrice);
    }

    // Apply category filter
    if (filters.category) {
      query = query.eq('category', filters.category);
    }

    // Apply condition filter
    if (filters.condition) {
      query = query.eq('condition', filters.condition);
    }

    // Apply search term filter
    if (filters.searchTerm) {
      query = query.or(`title.ilike.%${filters.searchTerm}%,description.ilike.%${filters.searchTerm}%`);
    }

    // Apply additional rental-specific filters
    if (filters.minMonths) {
      query = query.lte('furniture_listing_rentals.minimum_rental_months', filters.minMonths);
    }

    if (filters.rentToOwn === true || filters.rentToOwn === false) {
      query = query.eq('furniture_listing_rentals.rent_to_own_available', filters.rentToOwn);
    }

    // Apply sorting - default to sorting by monthly price for rentals
    const sortField = sortBy === 'price' ? 'furniture_listing_rentals.price_per_month' : sortBy;
    query = query.order(sortField, { ascending: sortOrder === 'asc' });

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching rental listings:', error);
      return { success: false, error: error.message };
    }

    // Fetch user information for each listing
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(item => item.user_id))];
      
      if (userIds.length > 0) {
        const { data: userData, error: userError } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', userIds);
        
        if (!userError && userData) {
          // Create a map of user data for quick lookup
          const userMap = {};
          userData.forEach(user => {
            userMap[user.id] = user;
          });
          
          // Add seller information to each listing
          data.forEach(listing => {
            const profileData = userMap[listing.user_id];
            listing.owner = profileData ? {
              id: profileData.id,
              full_name: profileData.full_name,
              avatar_url: profileData.avatar_url,
              rating: 4.5  // Hardcoded for now
            } : {
              full_name: 'Unknown User',
              avatar_url: null,
              rating: 0
            };
          });
        }
      }
    }

    return {
      success: true,
      rentals: data,
      count: count || data.length,
      page,
      limit,
      totalPages: Math.ceil((count || data.length) / limit)
    };
  } catch (error) {
    console.error('Unexpected error fetching rental listings:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get listings available for swap
 * @param {Object} filters - Filter options 
 * @param {string} sortBy - Sort field
 * @param {string} sortOrder - Sort order ('asc' or 'desc')
 * @param {number} page - Page number
 * @param {number} limit - Number of items per page
 */
export const getSwapListings = async (filters = {}, sortBy = 'created_at', sortOrder = 'desc', page = 1, limit = 10) => {
  try {
    console.log('getSwapListings: Starting query with filters:', filters);
    
    // Build the query to get all listings with swap options
    let query = supabase
      .from('furniture_listings')
      .select(`
        *,
        furniture_listing_swaps(*),
        furniture_listing_images(*)
      `)
      .eq('is_active', true)
      .not('furniture_listing_swaps', 'is', null);  // Only get listings with swap information

    // For debugging, try without the swap option filter
    // let query = supabase
    //   .from('furniture_listings')
    //   .select(`
    //     *,
    //     furniture_listing_swaps(*),
    //     furniture_listing_images(*)
    //   `)
    //   .eq('is_active', true);

    // Apply category filter
    if (filters.category) {
      query = query.eq('category', filters.category);
    }

    // Apply condition filter
    if (filters.condition) {
      query = query.eq('condition', filters.condition);
    }

    // Apply search term filter
    if (filters.searchTerm) {
      query = query.or(`title.ilike.%${filters.searchTerm}%,description.ilike.%${filters.searchTerm}%`);
    }

    // Apply location filter
    if (filters.location) {
      query = query.ilike('location', `%${filters.location}%`);
    }

    // Apply looking_for filter (items user is looking for)
    if (filters.lookingFor && filters.lookingFor.length > 0) {
      // This is a simplified approach - in real implementation we'd need a more sophisticated
      // text search across the looking_for array
      const lookingForTerms = filters.lookingFor.split(',').map(term => term.trim());
      const lookingForConditions = lookingForTerms.map(term => 
        `furniture_listing_swaps.looking_for.ilike.%${term}%`
      );
      query = query.or(lookingForConditions.join(','));
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    console.log('getSwapListings: Query built, executing...');

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching swap listings:', error);
      return { success: false, error: error.message };
    }

    console.log('getSwapListings: Raw data received:', data?.length || 0, 'items');

    // Fetch user information for each listing owner
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(item => item.user_id))];
      
      if (userIds.length > 0) {
        console.log('getSwapListings: Fetching user data for', userIds.length, 'users');
        
        const { data: userData, error: userError } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', userIds);
        
        if (userError) {
          console.error('Error fetching user data:', userError);
        } else if (userData) {
          console.log('getSwapListings: User data received for', userData.length, 'users');
          
          // Create a map of user data for quick lookup
          const userMap = {};
          userData.forEach(user => {
            userMap[user.id] = user;
          });
          
          // Add owner information to each listing
          data.forEach(listing => {
            const profileData = userMap[listing.user_id];
            listing.owner = profileData ? {
              id: profileData.id,
              full_name: profileData.full_name,
              avatar_url: profileData.avatar_url,
              rating: 4.5  // Hardcoded for now
            } : {
              full_name: 'Unknown User',
              avatar_url: null,
              rating: 0
            };
          });
        }
      }
    }

    console.log('getSwapListings: Returning processed data:', data?.length || 0, 'items');
    
    return {
      success: true,
      swaps: data || [],
      count: count || (data?.length || 0),
      page,
      limit,
      totalPages: Math.ceil((count || (data?.length || 0)) / limit)
    };
  } catch (error) {
    console.error('Unexpected error fetching swap listings:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get swap requests for a user (both sent and received)
 * @param {string} userId - The user ID
 * @param {string} type - 'sent', 'received', or 'all'
 * @param {string} status - Filter by status ('pending', 'accepted', 'rejected', 'completed') or 'all'
 */
export const getUserSwaps = async (userId, type = 'all', status = 'all') => {
  try {
    // Step 1: Get the swap requests without attempting joins
    let query = supabase
      .from('furniture_swaps')
      .select('*');

    // Filter by user role
    if (type === 'sent') {
      query = query.eq('requester_id', userId);
    } else if (type === 'received') {
      query = query.eq('owner_id', userId);
    } else {
      query = query.or(`requester_id.eq.${userId},owner_id.eq.${userId}`);
    }

    // Filter by status
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    // Order by updated_at date, newest first
    query = query.order('updated_at', { ascending: false });

    const { data: swapData, error } = await query;

    if (error) {
      console.error('Error fetching user swaps:', error);
      return { success: false, error: error.message };
    }

    // If no swaps found, return early
    if (!swapData || swapData.length === 0) {
      return { success: true, swaps: [] };
    }

    // Step 2: Fetch related user info
    const requesterIds = [...new Set(swapData.map(swap => swap.requester_id).filter(Boolean))];
    const ownerIds = [...new Set(swapData.map(swap => swap.owner_id).filter(Boolean))];
    const userIds = [...new Set([...requesterIds, ...ownerIds])];

    let userData = {};
    if (userIds.length > 0) {
      const { data: users, error: userError } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);
      
      if (userError) {
        console.error('Error fetching user data for swaps:', userError);
      } else if (users) {
        // Create a lookup map
        users.forEach(user => {
          userData[user.id] = user;
        });
      }
    }

    // Step 3: Fetch related listing info
    const requesterItemIds = [...new Set(swapData.map(swap => swap.requester_item_id).filter(Boolean))];
    const ownerItemIds = [...new Set(swapData.map(swap => swap.owner_item_id).filter(Boolean))];
    const itemIds = [...new Set([...requesterItemIds, ...ownerItemIds])];

    let itemData = {};
    if (itemIds.length > 0) {
      const { data: items, error: itemError } = await supabase
        .from('furniture_listings')
        .select('id, title, primary_image, condition')
        .in('id', itemIds);
      
      if (itemError) {
        console.error('Error fetching item data for swaps:', itemError);
      } else if (items) {
        // Create a lookup map
        items.forEach(item => {
          itemData[item.id] = item;
        });
      }
    }

    // Step 4: Combine all the data
    const swaps = swapData.map(swap => {
      return {
        ...swap,
        requester: userData[swap.requester_id] || { id: swap.requester_id, full_name: 'Unknown User' },
        owner: userData[swap.owner_id] || { id: swap.owner_id, full_name: 'Unknown User' },
        requester_item: itemData[swap.requester_item_id] || { id: swap.requester_item_id, title: 'Unknown Item' },
        owner_item: itemData[swap.owner_item_id] || { id: swap.owner_item_id, title: 'Unknown Item' }
      };
    });

    return { success: true, swaps };
  } catch (error) {
    console.error('Unexpected error fetching user swaps:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Create a swap request between two items
 * @param {string} requesterId - User ID of the person requesting the swap
 * @param {string} requesterItemId - Listing ID of the requester's item
 * @param {string} ownerItemId - Listing ID of the item they want to swap for
 * @param {string} message - Optional message to the owner
 */
export const createSwapRequest = async (requesterId, requesterItemId, ownerItemId, message = '') => {
  try {
    // First get the owner's ID
    const { data: ownerItem, error: itemError } = await supabase
      .from('furniture_listings')
      .select('user_id')
      .eq('id', ownerItemId)
      .single();

    if (itemError) {
      console.error('Error fetching item owner:', itemError);
      return { success: false, error: itemError.message };
    }

    // Create the swap request record
    const { data: swap, error: swapError } = await supabase
      .from('furniture_swaps')
      .insert({
        requester_id: requesterId,
        requester_item_id: requesterItemId,
        owner_id: ownerItem.user_id,
        owner_item_id: ownerItemId,
        message: message,
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (swapError) {
      console.error('Error creating swap request:', swapError);
      return { success: false, error: swapError.message };
    }

    return { success: true, swap };
  } catch (error) {
    console.error('Unexpected error creating swap request:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Update the status of a swap request
 * @param {string} swapId - The swap request ID
 * @param {string} userId - The user ID (must be the owner of the requested item)
 * @param {string} status - New status ('accepted', 'rejected', 'completed')
 */
export const updateSwapStatus = async (swapId, userId, status) => {
  try {
    // First verify this user is the owner of the requested item
    const { data: swap, error: fetchError } = await supabase
      .from('furniture_swaps')
      .select()
      .eq('id', swapId)
      .single();

    if (fetchError) {
      console.error('Error fetching swap request:', fetchError);
      return { success: false, error: fetchError.message };
    }

    if (swap.owner_id !== userId) {
      return { 
        success: false, 
        error: 'You do not have permission to update this swap request' 
      };
    }

    // Update the swap status
    const { error: updateError } = await supabase
      .from('furniture_swaps')
      .update({ 
        status: status,
        updated_at: new Date()
      })
      .eq('id', swapId);

    if (updateError) {
      console.error('Error updating swap status:', updateError);
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error updating swap status:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Create a rental request for a specific furniture item
 * @param {string} listingId - The listing ID
 * @param {string} renterId - The renter's user ID
 * @param {Object} rentalDetails - Details of the rental
 */
export const createRentalRequest = async (listingId, renterId, rentalDetails) => {
  try {
    // Get listing info first to retrieve owner_id
    const { data: listing, error: listingError } = await supabase
      .from('furniture_listings')
      .select('user_id')
      .eq('id', listingId)
      .single();

    if (listingError) {
      console.error('Error fetching listing for rental:', listingError);
      return { success: false, error: listingError.message };
    }

    // Create the rental record
    const { data: rental, error: rentalError } = await supabase
      .from('furniture_rentals')
      .insert({
        listing_id: listingId,
        renter_id: renterId,
        owner_id: listing.user_id,
        start_date: rentalDetails.startDate,
        end_date: rentalDetails.endDate,
        status: 'pending',
        monthly_rate: rentalDetails.monthlyRate,
        security_deposit: rentalDetails.securityDeposit,
        is_rent_to_own: rentalDetails.isRentToOwn || false,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (rentalError) {
      console.error('Error creating rental request:', rentalError);
      return { success: false, error: rentalError.message };
    }

    return { success: true, rental };
  } catch (error) {
    console.error('Unexpected error creating rental request:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get active rentals for a user (either as renter or owner)
 * @param {string} userId - The user ID
 * @param {string} role - 'renter', 'owner', or 'both'
 */
export const getUserRentals = async (userId, role = 'both') => {
  try {
    let query = supabase
      .from('furniture_rentals')
      .select(`
        *,
        furniture_listings(
          id, title, description, condition, category, primary_image
        )
      `);

    if (role === 'renter') {
      query = query.eq('renter_id', userId);
    } else if (role === 'owner') {
      query = query.eq('owner_id', userId);
    } else {
      // 'both' - get rentals where user is either renter or owner
      query = query.or(`renter_id.eq.${userId},owner_id.eq.${userId}`);
    }

    // Order by created date, newest first
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching user rentals:', error);
      return { success: false, error: error.message };
    }

    return { success: true, rentals: data };
  } catch (error) {
    console.error('Unexpected error fetching user rentals:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get a specific listing by ID
 * @param {string} id - The listing ID
 */
export const getListingById = async (id) => {
  try {
    const { data, error } = await supabase
      .from('furniture_listings')
      .select(`
        *,
        furniture_listing_sales(*),
        furniture_listing_rentals(*),
        furniture_listing_swaps(*),
        furniture_listing_images(*),
        profiles!furniture_listings_user_id_fkey(
          id, 
          full_name, 
          avatar_url, 
          created_at
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching listing:', error);
      return { success: false, error: error.message };
    }

    return { success: true, listing: data };
  } catch (error) {
    console.error('Unexpected error fetching listing:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get listings created by a specific user
 * @param {string} userId - The user ID
 */
export const getUserListings = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('furniture_listings')
      .select(`
        *,
        furniture_listing_sales(*),
        furniture_listing_rentals(*),
        furniture_listing_swaps(*),
        furniture_listing_images(*)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user listings:', error);
      return { success: false, error: error.message };
    }

    return { success: true, listings: data };
  } catch (error) {
    console.error('Unexpected error fetching user listings:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Toggle favorite status for a listing
 * @param {string} listingId - The listing ID
 * @param {string} userId - The user ID
 */
export const toggleFavoriteListing = async (listingId, userId) => {
  try {
    // Check if the listing is already favorited
    const { data: existingFavorite, error: checkError } = await supabase
      .from('furniture_listing_favorites')
      .select()
      .eq('listing_id', listingId)
      .eq('user_id', userId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 is the error code for no rows returned
      console.error('Error checking favorite status:', checkError);
      return { success: false, error: checkError.message };
    }

    if (existingFavorite) {
      // Remove favorite
      const { error: removeError } = await supabase
        .from('furniture_listing_favorites')
        .delete()
        .eq('id', existingFavorite.id);

      if (removeError) {
        console.error('Error removing favorite:', removeError);
        return { success: false, error: removeError.message };
      }

      return { success: true, isFavorite: false };
    } else {
      // Add favorite
      const { error: addError } = await supabase
        .from('furniture_listing_favorites')
        .insert({
          listing_id: listingId,
          user_id: userId,
          created_at: new Date()
        });

      if (addError) {
        console.error('Error adding favorite:', addError);
        return { success: false, error: addError.message };
      }

      return { success: true, isFavorite: true };
    }
  } catch (error) {
    console.error('Unexpected error toggling favorite:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Update an existing listing
 * @param {string} listingId - The listing ID
 * @param {Object} updates - The updates to apply
 * @param {string} userId - The user ID (for authorization)
 */
export const updateFurnitureListing = async (listingId, updates, userId) => {
  try {
    // First verify the user owns this listing
    const { data: listing, error: authError } = await supabase
      .from('furniture_listings')
      .select()
      .eq('id', listingId)
      .eq('user_id', userId)
      .single();

    if (authError || !listing) {
      console.error('Authorization error or listing not found:', authError);
      return { 
        success: false, 
        error: authError?.message || 'You do not have permission to update this listing' 
      };
    }

    // Update the base listing
    const { error: updateError } = await supabase
      .from('furniture_listings')
      .update({
        title: updates.title,
        description: updates.description,
        condition: updates.condition,
        category: updates.category,
        updated_at: new Date(),
        is_sanitized: updates.offerSanitization,
        includes_delivery: updates.includeDelivery,
        is_featured: updates.featureListing,
        location: updates.location,
      })
      .eq('id', listingId);

    if (updateError) {
      console.error('Error updating listing:', updateError);
      return { success: false, error: updateError.message };
    }

    // Handle updates to listing types
    if (updates.listingTypes) {
      // Update sale info if it exists
      if (updates.listingTypes.sell) {
        // Check if sale record exists
        const { data: existingSale } = await supabase
          .from('furniture_listing_sales')
          .select()
          .eq('listing_id', listingId)
          .single();

        if (existingSale) {
          await supabase
            .from('furniture_listing_sales')
            .update({ price: updates.salePrice })
            .eq('listing_id', listingId);
        } else {
          await supabase
            .from('furniture_listing_sales')
            .insert({
              listing_id: listingId,
              price: updates.salePrice,
            });
        }
      }

      // Update rental info if it exists
      if (updates.listingTypes.rent) {
        // Check if rental record exists
        const { data: existingRental } = await supabase
          .from('furniture_listing_rentals')
          .select()
          .eq('listing_id', listingId)
          .single();

        if (existingRental) {
          await supabase
            .from('furniture_listing_rentals')
            .update({
              price_per_month: updates.rentalPrice,
              security_deposit: updates.securityDeposit,
              minimum_rental_months: updates.minimumRental,
              rent_to_own_available: updates.rentToOwn || false,
              rent_to_own_price: updates.rentToOwnPrice,
              rent_to_own_months: updates.rentToOwnMonths,
            })
            .eq('listing_id', listingId);
        } else {
          await supabase
            .from('furniture_listing_rentals')
            .insert({
              listing_id: listingId,
              price_per_month: updates.rentalPrice,
              security_deposit: updates.securityDeposit,
              minimum_rental_months: updates.minimumRental,
              rent_to_own_available: updates.rentToOwn || false,
              rent_to_own_price: updates.rentToOwnPrice,
              rent_to_own_months: updates.rentToOwnMonths,
            });
        }
      }

      // Update swap info if it exists
      if (updates.listingTypes.swap) {
        // Check if swap record exists
        const { data: existingSwap } = await supabase
          .from('furniture_listing_swaps')
          .select()
          .eq('listing_id', listingId)
          .single();

        if (existingSwap) {
          await supabase
            .from('furniture_listing_swaps')
            .update({ looking_for: updates.lookingFor })
            .eq('listing_id', listingId);
        } else {
          await supabase
            .from('furniture_listing_swaps')
            .insert({
              listing_id: listingId,
              looking_for: updates.lookingFor,
            });
        }
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error updating listing:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete a listing
 * @param {string} listingId - The listing ID
 * @param {string} userId - The user ID (for authorization)
 */
export const deleteFurnitureListing = async (listingId, userId) => {
  try {
    // First verify the user owns this listing
    const { data: listing, error: authError } = await supabase
      .from('furniture_listings')
      .select()
      .eq('id', listingId)
      .eq('user_id', userId)
      .single();

    if (authError || !listing) {
      console.error('Authorization error or listing not found:', authError);
      return { 
        success: false, 
        error: authError?.message || 'You do not have permission to delete this listing' 
      };
    }

    // Set listing as inactive instead of actually deleting
    const { error: updateError } = await supabase
      .from('furniture_listings')
      .update({ is_active: false })
      .eq('id', listingId);

    if (updateError) {
      console.error('Error deactivating listing:', updateError);
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error deleting listing:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Record a view of a listing
 * @param {string} listingId - The listing ID
 * @param {string} userId - The user ID (optional)
 */
export const recordListingView = async (listingId, userId = null) => {
  try {
    const { error } = await supabase
      .from('furniture_listing_views')
      .insert({
        listing_id: listingId,
        user_id: userId,
        created_at: new Date()
      });

    if (error) {
      console.error('Error recording view:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error recording view:', error);
    return { success: false, error: error.message };
  }
};
