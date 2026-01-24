var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
var index_default = {
  async scheduled(event, env, ctx) {
    // Cron jobs have 15-minute limit, await the sync
    await syncListings(env);
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/sync") {
      ctx.waitUntil(syncListings(env));
      return new Response("Sync started in background! Check logs with 'npx wrangler tail'", { status: 200 });
    }
    if (url.pathname === "/sync-now") {
      await syncListings(env);
      return new Response("Sync complete!", { status: 200 });
    }
    if (url.pathname === "/publish") {
      ctx.waitUntil(publishAllItems(env));
      return new Response("Publishing all items in background! Check logs with 'npx wrangler tail'", { status: 200 });
    }
    if (url.pathname === "/status") {
      const result = await getStatus(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/test") {
      const result = await testOneListing(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/policies") {
      const result = await fetchCancellationPolicies(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/property-types") {
      const result = await debugPropertyTypes(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/debug") {
      const result = await debugOneListing(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    // NEW TEST ENDPOINT - SAFE TO ADD
    if (url.pathname === "/test-reviews") {
      const result = await testHostawayReviews(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    // DEBUG CALENDAR PRICING
    if (url.pathname === "/test-pricing") {
      const result = await testPricingCalculation(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("Hostaway to Webflow Sync Worker.\n\nEndpoints:\n/sync - Trigger sync (background)\n/status - Check listing counts\n/test - Check data mapping\n/debug - See raw amenities\n/test-reviews - Test reviews API\n/test-pricing - Debug pricing calculation (NEW)", { status: 200 });
  }
};

// ALL EXISTING CODE BELOW - NO CHANGES

var CANCELLATION_POLICY_TEXT = {
  "flexible": "Free cancellation up to 24 hours before check-in. After that, cancel before check-in and get a full refund, minus the first night and service fee.",
  "moderate": "Free cancellation up to 5 days before check-in. After that, cancel up to 24 hours before check-in and get a 50% refund, minus the service fee.",
  "firm": "Full refund up to 30 days before check-in. 50% refund if cancelled 7-30 days before check-in. No refund within 7 days of check-in.",
  "strict": "Full refund if cancelled within 48 hours of booking and at least 14 days before check-in. 50% refund if cancelled at least 7 days before check-in. No refund after that.",
  "strict_14_with_grace_period": "Full refund if cancelled within 48 hours of booking and at least 14 days before check-in. 50% refund if cancelled at least 7 days before check-in. No refund after that.",
  "super_strict_30": "50% refund up to 30 days before check-in. No refund after that.",
  "super_strict_60": "50% refund up to 60 days before check-in. No refund after that.",
  "long_term": "First month is non-refundable. For stays over 28 nights, 30 days notice required to cancel.",
  "non_refundable": "Non-refundable. Guests pay the full amount if they cancel.",
  "standard": "Standard cancellation policy applies. Please contact us for details."
};
var PET_AMENITY_NAMES = [
  "pets allowed",
  "pets welcome",
  "pet friendly",
  "dog friendly",
  "cat friendly",
  "allows pets"
];
var SMOKING_AMENITY_NAMES = [
  "smoking allowed",
  "smoking permitted"
];
var CHILDREN_AMENITY_NAMES = [
  "suitable for children",
  "children welcome",
  "family friendly",
  "suitable for kids"
];
var INFANTS_AMENITY_NAMES = [
  "suitable for infants",
  "infants welcome",
  "baby friendly"
];
function formatTime(hour) {
  if (hour === null || hour === void 0) return "";
  const h = parseInt(hour);
  if (isNaN(h)) return "";
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}
__name(formatTime, "formatTime");
function formatPropertyType(listing) {
  const propertyTypeMap = {
    1: "Apartment",
    2: "House",
    3: "Bed & Breakfast",
    4: "Boutique Hotel",
    5: "Cabin",
    6: "Condo",
    7: "Cabin",
    8: "Villa",
    9: "Cottage",
    10: "Townhouse",
    11: "Bungalow",
    12: "Chalet",
    13: "Guest House",
    14: "Loft",
    15: "Resort"
  };
  const typeId = listing.propertyTypeId;
  const roomType = listing.roomType || "entire_home";
  const typeName = propertyTypeMap[typeId] || "Home";
  if (roomType === "private_room") {
    return `Private Room in ${typeName}`;
  }
  if (roomType === "shared_room") {
    return `Shared Room in ${typeName}`;
  }
  return typeName;
}
__name(formatPropertyType, "formatPropertyType");
function hasAmenity(amenities, targetNames) {
  if (!amenities || !Array.isArray(amenities)) return false;
  const amenityNames = amenities.map((a) => (a.amenityName || "").toLowerCase().trim());
  return targetNames.some(
    (target) => amenityNames.some((name) => name.includes(target.toLowerCase()))
  );
}
__name(hasAmenity, "hasAmenity");
function isPetsAllowed(listing) {
  const amenities = listing.listingAmenities || [];
  if (hasAmenity(amenities, PET_AMENITY_NAMES)) {
    return true;
  }
  if (listing.maxPetsAllowed !== null && listing.maxPetsAllowed !== void 0 && listing.maxPetsAllowed > 0) {
    return true;
  }
  return false;
}
__name(isPetsAllowed, "isPetsAllowed");
function isSmokingAllowed(listing) {
  const amenities = listing.listingAmenities || [];
  return hasAmenity(amenities, SMOKING_AMENITY_NAMES);
}
__name(isSmokingAllowed, "isSmokingAllowed");
function isChildrenAllowed(listing) {
  const amenities = listing.listingAmenities || [];
  if (hasAmenity(amenities, CHILDREN_AMENITY_NAMES)) {
    return true;
  }
  if (listing.maxChildrenAllowed !== null && listing.maxChildrenAllowed !== void 0 && listing.maxChildrenAllowed > 0) {
    return true;
  }
  return false;
}
__name(isChildrenAllowed, "isChildrenAllowed");
function isInfantsAllowed(listing) {
  const amenities = listing.listingAmenities || [];
  if (hasAmenity(amenities, INFANTS_AMENITY_NAMES)) {
    return true;
  }
  if (listing.maxInfantsAllowed !== null && listing.maxInfantsAllowed !== void 0 && listing.maxInfantsAllowed > 0) {
    return true;
  }
  return false;
}
__name(isInfantsAllowed, "isInfantsAllowed");
function getCancellationPolicyText(listing, policiesFromAPI) {
  if (listing.cancellationPolicyId && policiesFromAPI) {
    const policy = policiesFromAPI[listing.cancellationPolicyId];
    if (policy) {
      if (policy.description) return policy.description;
      if (policy.text) return policy.text;
      if (policy.name) {
        const normalizedName = policy.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
        if (CANCELLATION_POLICY_TEXT[normalizedName]) {
          return CANCELLATION_POLICY_TEXT[normalizedName];
        }
        return policy.name;
      }
    }
  }
  const policyType = (listing.cancellationPolicy || "standard").toLowerCase().replace(/[^a-z0-9]/g, "_");
  return CANCELLATION_POLICY_TEXT[policyType] || CANCELLATION_POLICY_TEXT["standard"];
}
__name(getCancellationPolicyText, "getCancellationPolicyText");
function buildHouseRulesHTML(listing) {
  const checkInTime = formatTime(listing.checkInTimeStart);
  const checkOutTime = formatTime(listing.checkOutTime);
  const childrenAllowed = isChildrenAllowed(listing);
  const infantsAllowed = isInfantsAllowed(listing);
  const petsAllowed = isPetsAllowed(listing);
  const smokingAllowed = isSmokingAllowed(listing);
  const rules = [];
  if (checkInTime) {
    rules.push({ icon: "clock", label: "Check-in", value: checkInTime, allowed: true });
  }
  if (checkOutTime) {
    rules.push({ icon: "clock", label: "Check-out", value: checkOutTime, allowed: true });
  }
  rules.push({ icon: "child", label: "Children", value: childrenAllowed ? "allowed" : "not allowed", allowed: childrenAllowed });
  rules.push({ icon: "baby", label: "Infants", value: infantsAllowed ? "allowed" : "not allowed", allowed: infantsAllowed });
  rules.push({ icon: "paw", label: "Pets", value: petsAllowed ? "allowed" : "not allowed", allowed: petsAllowed });
  rules.push({ icon: "smoking", label: "Smoking", value: smokingAllowed ? "allowed" : "not allowed", allowed: smokingAllowed });
  rules.push({ icon: "party", label: "Parties/events", value: "not allowed", allowed: false });
  let html = '<div class="house-rules-grid">';
  for (const rule of rules) {
    const statusClass = rule.allowed ? "rule-allowed" : "rule-not-allowed";
    html += `<div class="house-rule-item ${statusClass}" data-icon="${rule.icon}">`;
    html += `<span class="rule-icon rule-icon-${rule.icon}"></span>`;
    html += `<span class="rule-text"><strong>${rule.label}:</strong> ${rule.value}</span>`;
    html += `</div>`;
  }
  html += "</div>";
  const additionalRules = (listing.houseRules || "").replace(/[\n\r]+/g, " ").trim();
  if (additionalRules) {
    html += `<div class="house-rules-additional"><strong>Additional Rules:</strong> ${additionalRules}</div>`;
  }
  return html;
}
__name(buildHouseRulesHTML, "buildHouseRulesHTML");
function buildAmenitiesHTML(listing) {
  const amenities = listing.listingAmenities || [];
  if (amenities.length === 0) return "";
  let html = '<div class="amenities-grid">';
  for (const amenity of amenities) {
    const name = amenity.amenityName || "";
    if (!name) continue;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    html += `<div class="amenity-item" data-amenity="${slug}">`;
    html += `<span class="amenity-icon amenity-icon-${slug}"></span>`;
    html += `<span class="amenity-name">${name}</span>`;
    html += `</div>`;
  }
  html += "</div>";
  return html;
}
__name(buildAmenitiesHTML, "buildAmenitiesHTML");
function buildImagesHTML(listing) {
  const images = listing.listingImages || [];
  if (images.length === 0) return "";
  let html = '<div class="images-gallery">';
  for (const img of images) {
    const url = img.url || "";
    if (!url) continue;
    const caption = (img.caption || "").replace(/[\n\r]+/g, " ").replace(/"/g, "&quot;");
    html += `<div class="image-item"><img src="${url}" alt="${caption}" loading="lazy"></div>`;
  }
  html += "</div>";
  return html;
}
__name(buildImagesHTML, "buildImagesHTML");
function getFeaturedImage(listing) {
  const images = listing.listingImages || [];
  if (images.length === 0) return "";
  const sorted = [...images].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  return sorted[0]?.url || "";
}
__name(getFeaturedImage, "getFeaturedImage");
async function getHostawayToken(env) {
  console.log("ENV check - HOSTAWAY_ACCOUNT_ID exists:", !!env.HOSTAWAY_ACCOUNT_ID);
  console.log("ENV check - HOSTAWAY_API_SECRET exists:", !!env.HOSTAWAY_API_SECRET);
  if (!env.HOSTAWAY_ACCOUNT_ID || !env.HOSTAWAY_API_SECRET) {
    console.log("Missing Hostaway credentials in environment");
    return null;
  }
  try {
    const response = await fetch("https://api.hostaway.com/v1/accessTokens", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${env.HOSTAWAY_ACCOUNT_ID}&client_secret=${env.HOSTAWAY_API_SECRET}&scope=general`
    });
    const data = await response.json();
    console.log("Token response status:", response.status);
    if (!data.access_token) {
      console.log("Token error:", JSON.stringify(data));
      return null;
    }
    return data.access_token;
  } catch (error) {
    console.log("Token fetch error:", error.message);
    return null;
  }
}
__name(getHostawayToken, "getHostawayToken");
async function fetchHostawayListings(token) {
  let allListings = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const response = await fetch(`https://api.hostaway.com/v1/listings?includeResources=1&limit=${limit}&offset=${offset}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Cache-Control": "no-cache"
      }
    });
    const data = await response.json();
    console.log(`Listings API status: ${data.status}, fetched ${data.result?.length || 0} listings (offset: ${offset})`);
    if (data.status === "fail") {
      console.log("Listings API error:", data.result || data.message);
      break;
    }
    const listings = data.result || [];
    if (listings.length === 0) {
      break;
    }
    allListings = allListings.concat(listings);
    if (listings.length < limit) {
      break;
    }
    offset += limit;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.log(`Total listings fetched: ${allListings.length}`);
  return allListings;
}
__name(fetchHostawayListings, "fetchHostawayListings");
async function fetchCancellationPolicies(env) {
  const token = await getHostawayToken(env);
  const response = await fetch("https://api.hostaway.com/v1/cancellationPolicies", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Cache-Control": "no-cache"
    }
  });
  const data = await response.json();
  let airbnbPolicies = [];
  try {
    const airbnbResponse = await fetch("https://api.hostaway.com/v1/airbnbCancellationPolicies", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Cache-Control": "no-cache"
      }
    });
    const airbnbData = await airbnbResponse.json();
    airbnbPolicies = airbnbData.result || [];
  } catch (e) {
    console.log("Could not fetch Airbnb policies:", e.message);
  }
  const policiesMap = {};
  const policies = data.result || [];
  for (const p of policies) {
    policiesMap[p.id] = p;
  }
  for (const p of airbnbPolicies) {
    policiesMap[p.id] = p;
  }
  return {
    general: policies,
    airbnb: airbnbPolicies,
    map: policiesMap
  };
}
__name(fetchCancellationPolicies, "fetchCancellationPolicies");
async function getWebflowItems(env) {
  let allItems = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const response = await fetch(
      `https://api.webflow.com/v2/collections/${env.WEBFLOW_COLLECTION_ID}/items?limit=${limit}&offset=${offset}`,
      {
        headers: {
          "Authorization": `Bearer ${env.WEBFLOW_API_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    const data = await response.json();
    const items = data.items || [];
    if (items.length === 0) {
      break;
    }
    allItems = allItems.concat(items);
    if (items.length < limit) {
      break;
    }
    offset += limit;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return allItems;
}
__name(getWebflowItems, "getWebflowItems");
async function createWebflowItem(env, fields) {
  const response = await fetch(
    `https://api.webflow.com/v2/collections/${env.WEBFLOW_COLLECTION_ID}/items`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.WEBFLOW_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fieldData: fields, isArchived: false, isDraft: false })
    }
  );
  const data = await response.json();
  console.log("Create item:", response.ok ? "Success" : JSON.stringify(data));
  return data;
}
__name(createWebflowItem, "createWebflowItem");
async function updateWebflowItem(env, itemId, fields) {
  const response = await fetch(
    `https://api.webflow.com/v2/collections/${env.WEBFLOW_COLLECTION_ID}/items/${itemId}`,
    {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${env.WEBFLOW_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fieldData: fields, isArchived: false, isDraft: false })
    }
  );
  const data = await response.json();
  console.log("Update item:", response.ok ? "Success" : JSON.stringify(data));
  return data;
}
__name(updateWebflowItem, "updateWebflowItem");
async function publishWebflowItems(env, itemIds) {
  if (!itemIds || itemIds.length === 0) return;
  const response = await fetch(
    `https://api.webflow.com/v2/collections/${env.WEBFLOW_COLLECTION_ID}/items/publish`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.WEBFLOW_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ itemIds })
    }
  );
  const data = await response.json();
  console.log("Publish items:", response.ok ? "Success" : JSON.stringify(data));
  return data;
}
__name(publishWebflowItems, "publishWebflowItems");
async function publishWebflowSite(env) {
  console.log("Calling Webflow site publish API...");
  const domainsResponse = await fetch(
    `https://api.webflow.com/v2/sites/${env.WEBFLOW_SITE_ID}`,
    {
      headers: {
        "Authorization": `Bearer ${env.WEBFLOW_API_TOKEN}`
      }
    }
  );
  const siteData = await domainsResponse.json();
  let domainIds = [];
  if (siteData.customDomains && siteData.customDomains.length > 0) {
    domainIds = siteData.customDomains.map((d) => d.id);
  }
  if (siteData.defaultDomain) {
    domainIds.push(siteData.defaultDomain.id);
  }
  console.log(`Publishing to ${domainIds.length} domains...`);
  const response = await fetch(
    `https://api.webflow.com/v2/sites/${env.WEBFLOW_SITE_ID}/publish`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.WEBFLOW_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ publishToWebflowSubdomain: true, customDomains: domainIds })
    }
  );
  const data = await response.json();
  console.log("Site publish result:", response.ok ? "Success" : JSON.stringify(data));
  return data;
}
__name(publishWebflowSite, "publishWebflowSite");
async function calculate90DayAverage(listingId, token) {
  try {
    // Get today's date and 90 days from now
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + 90);
    
    // Format dates as YYYY-MM-DD
    const startDateStr = today.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    // Fetch calendar data - Correct endpoint format
    const response = await fetch(
      `https://api.hostaway.com/v1/listings/${listingId}/calendar?startDate=${startDateStr}&endDate=${endDateStr}`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Cache-Control": "no-cache"
        }
      }
    );
    
    if (!response.ok) {
      console.log(`   Warning: Calendar API failed for listing ${listingId}`);
      return null;
    }
    
    const data = await response.json();
    const days = data.result || [];
    
    if (days.length === 0) {
      return null;
    }
    
    // Filter to available days with prices
    const availableDays = days.filter(day => 
      day.status === 'available' && 
      day.price && 
      parseFloat(day.price) > 0
    );
    
    if (availableDays.length === 0) {
      return null;
    }
    
    // Calculate average
    const total = availableDays.reduce((sum, day) => sum + parseFloat(day.price), 0);
    const average = Math.round(total / availableDays.length);
    
    return average;
  } catch (err) {
    console.log(`   Warning: Could not calculate average price for listing ${listingId}: ${err.message}`);
    return null;
  }
}
__name(calculate90DayAverage, "calculate90DayAverage");
async function mapListingToWebflow(listing, cancellationPoliciesMap, token) {
  const listingId = String(listing.id);
  const petsAllowed = isPetsAllowed(listing);
  const smokingAllowed = isSmokingAllowed(listing);
  const cancellationText = getCancellationPolicyText(listing, cancellationPoliciesMap);
  
  // Get images and amenities arrays
  const images = listing.listingImages || [];
  const amenities = listing.listingAmenities || [];
  
  // NEW: Fetch reviews for this listing
  let reviewComments = "";
  try {
    const reviewsResponse = await fetch(
      `https://api.hostaway.com/v1/reviews?listingId=${listing.id}`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Cache-Control": "no-cache"
        }
      }
    );
    
    if (reviewsResponse.ok) {
      const reviewsData = await reviewsResponse.json();
      
      // Filter: rating ≥ 9 (equivalent to 4.5+ stars), published status, has text
      const topReviews = (reviewsData.result || [])
        .filter(r => 
          r.status === 'published' && 
          r.rating >= 9 && 
          r.publicReview && 
          r.publicReview.trim()
        )
        .map(r => r.publicReview.trim());
      
      // Join with separator
      reviewComments = topReviews.join(" | ");
    }
  } catch (err) {
    console.log(`   Warning: Could not fetch reviews for listing ${listing.id}: ${err.message}`);
  }
  
  // NEW: Calculate 90-day average price
  let averagePrice = listing.price || 0;
  try {
    const calculatedAverage = await calculate90DayAverage(listing.id, token);
    if (calculatedAverage !== null) {
      averagePrice = calculatedAverage;
    }
  } catch (err) {
    console.log(`   Warning: Could not calculate average price for listing ${listing.id}: ${err.message}`);
  }
  
  return {
    "name": listing.name || listing.externalListingName || "Untitled",
    "slug": listingId,
    "listing-id": listingId,
    "property-type": formatPropertyType(listing),
    "description": listing.description || "",
    "house-rules-3": buildHouseRulesHTML(listing),
    "guests": listing.personCapacity || 0,
    "bedrooms": listing.bedroomsNumber || 0,
    "beds": listing.bedsNumber || 0,
    "bathrooms": listing.bathroomsNumber || 0,
    "price": averagePrice,
    "min-nights": listing.minNights || 1,
    "check-in-time": formatTime(listing.checkInTimeStart),
    "check-out-time": formatTime(listing.checkOutTime),
    "pets-allowed": petsAllowed,
    "smoking-allowed": smokingAllowed,
    "cancellation-policy": cancellationText,
    "images-html": buildImagesHTML(listing),
    "amenities-html": buildAmenitiesHTML(listing),
    "featured-image": getFeaturedImage(listing),
    "city": listing.city || "",
    "state": listing.state || "",
    "latitude": listing.lat ? String(listing.lat) : "",
    "longitude": listing.lng ? String(listing.lng) : "",
    "is-live": listing.specialStatus !== "archived",
    
    // NEW FIELDS
    "images-urls-2": images.map(img => img.url).join(", "),
    "amenities-list": amenities.map(a => a.amenityName).join(", "),
    "average-rating": listing.averageReviewRating ? (listing.averageReviewRating / 2) : 0,
    "review-comments": reviewComments,
    "booking-engine-active": listing.isBookingEngineActive === 1 || listing.isBookingEngineActive === true
  };
}
__name(mapListingToWebflow, "mapListingToWebflow");
async function testOneListing(env) {
  try {
    const token = await getHostawayToken(env);
    const listings = await fetchHostawayListings(token);
    const policiesData = await fetchCancellationPolicies(env);
    if (listings.length === 0) {
      return { error: "No listings found" };
    }
    const listing = listings.find((l) => l.specialStatus !== "archived") || listings[0];
    const fields = await mapListingToWebflow(listing, policiesData.map, token);
    return {
      listingId: listing.id,
      listingName: listing.name,
      rawData: {
        cancellationPolicy: listing.cancellationPolicy,
        cancellationPolicyId: listing.cancellationPolicyId,
        maxPetsAllowed: listing.maxPetsAllowed,
        maxChildrenAllowed: listing.maxChildrenAllowed,
        maxInfantsAllowed: listing.maxInfantsAllowed,
        houseRules: listing.houseRules,
        checkInTimeStart: listing.checkInTimeStart,
        checkOutTime: listing.checkOutTime
      },
      computedValues: {
        petsAllowed: fields["pets-allowed"],
        smokingAllowed: fields["smoking-allowed"],
        cancellationPolicyText: fields["cancellation-policy"]
      },
      webflowFields: fields
    };
  } catch (error) {
    return { error: error.message };
  }
}
__name(testOneListing, "testOneListing");
async function debugPropertyTypes(env) {
  try {
    const token = await getHostawayToken(env);
    const listings = await fetchHostawayListings(token);
    const propertyTypes = {};
    for (const listing of listings) {
      const typeId = listing.propertyTypeId;
      const roomType = listing.roomType;
      const key = `${typeId}_${roomType}`;
      if (!propertyTypes[key]) {
        propertyTypes[key] = {
          propertyTypeId: typeId,
          roomType,
          count: 0,
          examples: []
        };
      }
      propertyTypes[key].count++;
      if (propertyTypes[key].examples.length < 2) {
        propertyTypes[key].examples.push(listing.name);
      }
    }
    return {
      totalListings: listings.length,
      propertyTypes: Object.values(propertyTypes)
    };
  } catch (error) {
    return { error: error.message };
  }
}
__name(debugPropertyTypes, "debugPropertyTypes");
async function debugOneListing(env) {
  try {
    const envStatus = {
      HOSTAWAY_ACCOUNT_ID: !!env.HOSTAWAY_ACCOUNT_ID,
      HOSTAWAY_API_SECRET: !!env.HOSTAWAY_API_SECRET,
      WEBFLOW_API_TOKEN: !!env.WEBFLOW_API_TOKEN,
      WEBFLOW_COLLECTION_ID: !!env.WEBFLOW_COLLECTION_ID,
      WEBFLOW_SITE_ID: !!env.WEBFLOW_SITE_ID
    };
    const token = await getHostawayToken(env);
    if (!token) {
      return {
        error: "Failed to get Hostaway token",
        envVariablesSet: envStatus,
        hint: "Check if secrets are properly configured in Cloudflare"
      };
    }
    const response = await fetch("https://api.hostaway.com/v1/listings?includeResources=1&limit=1", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Cache-Control": "no-cache"
      }
    });
    const data = await response.json();
    if (data.status === "fail") {
      return {
        error: "Hostaway API error",
        apiStatus: data.status,
        apiMessage: data.result || data.message,
        fullResponse: data
      };
    }
    const listings = data.result || [];
    if (listings.length === 0) {
      return {
        error: "No listings found",
        apiStatus: data.status,
        apiCount: data.count,
        fullResponse: data
      };
    }
    const listing = listings[0];
    const amenities = listing.listingAmenities || [];
    const petRelated = amenities.filter((a) => {
      const name = (a.amenityName || "").toLowerCase();
      return name.includes("pet") || name.includes("dog") || name.includes("cat") || name.includes("animal");
    });
    const smokingRelated = amenities.filter((a) => {
      const name = (a.amenityName || "").toLowerCase();
      return name.includes("smok");
    });
    return {
      listingId: listing.id,
      listingName: listing.name,
      totalAmenities: amenities.length,
      allAmenityNames: amenities.map((a) => a.amenityName),
      petRelatedAmenities: petRelated.map((a) => a.amenityName),
      smokingRelatedAmenities: smokingRelated.map((a) => a.amenityName),
      maxPetsAllowed: listing.maxPetsAllowed,
      isPetsAllowed: isPetsAllowed(listing),
      isSmokingAllowed: isSmokingAllowed(listing),
      cancellationPolicy: listing.cancellationPolicy,
      cancellationPolicyId: listing.cancellationPolicyId
    };
  } catch (error) {
    return { error: error.message, stack: error.stack };
  }
}
__name(debugOneListing, "debugOneListing");
async function publishAllItems(env) {
  console.log("=== Publishing All Items ===");
  try {
    const webflowItems = await getWebflowItems(env);
    console.log(`Found ${webflowItems.length} items to publish`);
    if (webflowItems.length === 0) {
      console.log("No items to publish!");
      return;
    }
    const allIds = webflowItems.map((item) => item.id);
    console.log(`First few IDs: ${allIds.slice(0, 3).join(", ")}`);
    for (let i = 0; i < allIds.length; i += 100) {
      const batch = allIds.slice(i, i + 100);
      console.log(`Publishing batch ${Math.floor(i / 100) + 1} (${batch.length} items)...`);
      const result = await publishWebflowItems(env, batch);
      console.log(`Batch result: ${JSON.stringify(result).substring(0, 200)}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log("Publishing site...");
    await publishWebflowSite(env);
    console.log("=== Publish Complete ===");
  } catch (error) {
    console.error("Publish error:", error.message);
  }
}
__name(publishAllItems, "publishAllItems");
async function getStatus(env) {
  try {
    const token = await getHostawayToken(env);
    const allListings = await fetchHostawayListings(token);
    const activeListings = allListings.filter((l) => l.specialStatus !== "archived");
    const webflowItems = await getWebflowItems(env);
    return {
      hostaway: {
        total: allListings.length,
        active: activeListings.length,
        archived: allListings.length - activeListings.length
      },
      webflow: {
        total: webflowItems.length
      },
      needsSync: activeListings.length - webflowItems.length
    };
  } catch (error) {
    return { error: error.message };
  }
}
__name(getStatus, "getStatus");
async function syncListings(env) {
  console.log("=== Starting Hostaway to Webflow Sync ===");
  try {
    console.log("1. Getting Hostaway token...");
    const token = await getHostawayToken(env);
    console.log("2. Fetching Hostaway listings...");
    const allListings = await fetchHostawayListings(token);
    console.log(`   Found ${allListings.length} total listings`);
    const listings = allListings.filter((l) => l.specialStatus !== "archived");
    console.log(`   ${listings.length} active listings after filtering`);
    console.log("3. Fetching cancellation policies...");
    const policiesData = await fetchCancellationPolicies(env);
    console.log(`   Found ${Object.keys(policiesData.map).length} policies`);
    console.log("4. Getting existing Webflow items...");
    const webflowItems = await getWebflowItems(env);
    console.log(`   Found ${webflowItems.length} existing items`);
    const webflowMap = {};
    for (const item of webflowItems) {
      const listingId = item.fieldData?.["listing-id"];
      if (listingId) {
        webflowMap[listingId] = item;
      }
    }
    const newListings = [];
    const existingListings = [];
    for (const listing of listings) {
      const id = String(listing.id);
      if (webflowMap[id]) {
        existingListings.push(listing);
      } else {
        newListings.push(listing);
      }
    }
    console.log(`5. Processing ${listings.length} listings (${newListings.length} new, ${existingListings.length} existing)...`);
    console.log(`   Creating NEW listings first to maximize progress...`);
    const createdIds = [];
    const updatedIds = [];
    let processed = 0;
    const batchToPublish = [];
    for (const listing of newListings) {
      const id = String(listing.id);
      try {
        const fields = await mapListingToWebflow(listing, policiesData.map, token);
        const result = await createWebflowItem(env, fields);
        if (result.id) {
          createdIds.push(result.id);
          batchToPublish.push(result.id);
          if (batchToPublish.length >= 20) {
            console.log(`   Publishing batch of ${batchToPublish.length} items...`);
            await publishWebflowItems(env, batchToPublish);
            batchToPublish.length = 0;
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        } else {
          console.log(`   FAILED to create listing ${id}: ${JSON.stringify(result)}`);
        }
      } catch (err) {
        console.log(`   ERROR creating listing ${id} (${listing.name}): ${err.message}`);
      }
      processed++;
      if (processed % 10 === 0) {
        console.log(`   Created ${processed}/${newListings.length} new listings...`);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (batchToPublish.length > 0) {
      console.log(`   Publishing final batch of ${batchToPublish.length} new items...`);
      await publishWebflowItems(env, batchToPublish);
    }
    console.log(`   Finished creating ${createdIds.length} new listings. Now updating existing...`);
    for (const listing of existingListings) {
      const id = String(listing.id);
      try {
        const fields = await mapListingToWebflow(listing, policiesData.map, token);
        const existingItem = webflowMap[id];
        const result = await updateWebflowItem(env, existingItem.id, fields);
        if (result.id) updatedIds.push(result.id);
      } catch (err) {
        console.log(`   ERROR updating listing ${id}: ${err.message}`);
      }
      processed++;
      if (processed % 25 === 0) {
        console.log(`   Progress: ${processed}/${listings.length} total...`);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    console.log(`   Finished processing all ${processed} listings`);
    if (updatedIds.length > 0) {
      console.log(`6. Publishing ${updatedIds.length} updated items...`);
      for (let i = 0; i < updatedIds.length; i += 100) {
        const batch = updatedIds.slice(i, i + 100);
        await publishWebflowItems(env, batch);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (createdIds.length > 0 || updatedIds.length > 0) {
      console.log("7. Publishing site...");
      await publishWebflowSite(env);
    }
    
    // 8. Archive/Delete listings that no longer exist in Hostaway
    console.log("8. Checking for listings to archive...");
    const hostawayIds = new Set(listings.map(l => String(l.id)));
    const toArchive = [];
    
    for (const webflowItem of webflowItems) {
      const listingId = webflowItem.fieldData?.["listing-id"];
      if (listingId && !hostawayIds.has(listingId)) {
        toArchive.push(webflowItem);
      }
    }
    
    if (toArchive.length > 0) {
      console.log(`   Found ${toArchive.length} listings to archive`);
      for (const item of toArchive) {
        try {
          // Archive the item (set isDraft or isArchived)
          await fetch(
            `https://api.webflow.com/v2/collections/${env.WEBFLOW_COLLECTION_ID}/items/${item.id}`,
            {
              method: "PATCH",
              headers: {
                "Authorization": `Bearer ${env.WEBFLOW_API_TOKEN}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ 
                fieldData: { "is-live": false },
                isArchived: true 
              })
            }
          );
          console.log(`   Archived listing ${item.fieldData?.["listing-id"]}`);
        } catch (err) {
          console.log(`   ERROR archiving listing ${item.fieldData?.["listing-id"]}: ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } else {
      console.log(`   No listings to archive`);
    }
    
    console.log("=== Sync Complete ===");
    console.log(`   Created: ${createdIds.length}, Updated: ${updatedIds.length}, Archived: ${toArchive.length}`);
  } catch (error) {
    console.error("!!! Sync error:", error.message);
    throw error;
  }
}
__name(syncListings, "syncListings");

// NEW TEST FUNCTION - SAFE TO ADD
async function testHostawayReviews(env) {
  try {
    console.log("=== Testing Hostaway Reviews API ===");
    
    const token = await getHostawayToken(env);
    if (!token) {
      return { error: "Failed to get token" };
    }
    
    const listingsResponse = await fetch(
      "https://api.hostaway.com/v1/listings?limit=1&includeResources=1",
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Cache-Control": "no-cache"
        }
      }
    );
    const listingsData = await listingsResponse.json();
    const listing = listingsData.result?.[0];
    
    if (!listing) {
      return { error: "No listings found" };
    }
    
    console.log(`Testing with listing: ${listing.id} - ${listing.name}`);
    console.log(`Average review rating from listing: ${listing.averageReviewRating}`);
    
    const reviewsResponse = await fetch(
      `https://api.hostaway.com/v1/reviews?listingId=${listing.id}`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Cache-Control": "no-cache"
        }
      }
    );
    
    const reviewsStatus = reviewsResponse.status;
    let reviewsData = null;
    
    try {
      reviewsData = await reviewsResponse.json();
    } catch (e) {
      reviewsData = { parseError: "Could not parse JSON" };
    }
    
    return {
      listingInfo: {
        id: listing.id,
        name: listing.name,
        averageReviewRating: listing.averageReviewRating,
        starRating: listing.starRating
      },
      reviewsEndpointTest: {
        url: `https://api.hostaway.com/v1/reviews?listingId=${listing.id}`,
        status: reviewsStatus,
        statusText: reviewsResponse.statusText,
        data: reviewsData
      },
      notes: [
        "If status is 404, reviews endpoint doesn't exist",
        "If status is 403, we don't have permission",
        "If status is 200, reviews are available!"
      ]
    };
    
  } catch (error) {
    return { 
      error: error.message,
      stack: error.stack 
    };
  }
}
__name(testHostawayReviews, "testHostawayReviews");

async function testPricingCalculation(env) {
  try {
    console.log("=== Testing Calendar Pricing API ===");
    
    const token = await getHostawayToken(env);
    if (!token) {
      return { error: "Failed to get token" };
    }
    
    const listingsResponse = await fetch(
      "https://api.hostaway.com/v1/listings?limit=1&includeResources=1",
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Cache-Control": "no-cache"
        }
      }
    );
    const listingsData = await listingsResponse.json();
    const listing = listingsData.result?.[0];
    
    if (!listing) {
      return { error: "No listings found" };
    }
    
    console.log(`Testing with listing: ${listing.id} - ${listing.name}`);
    console.log(`Rack rate price from listing: ${listing.price}`);
    
    // Test calendar API
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + 90);
    const startDateStr = today.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const calendarUrl = `https://api.hostaway.com/v1/listings/${listing.id}/calendar?startDate=${startDateStr}&endDate=${endDateStr}`;
    console.log(`Calendar URL: ${calendarUrl}`);
    
    const calendarResponse = await fetch(calendarUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Cache-Control": "no-cache"
      }
    });
    
    const calendarStatus = calendarResponse.status;
    let calendarData = null;
    
    try {
      calendarData = await calendarResponse.json();
    } catch (e) {
      calendarData = { parseError: "Could not parse JSON" };
    }
    
    // Try to calculate average
    let calculatedAverage = null;
    let availableDaysCount = 0;
    let totalDaysCount = 0;
    
    if (calendarData && calendarData.result) {
      const days = calendarData.result;
      totalDaysCount = days.length;
      
      const availableDays = days.filter(day => 
        day.status === 'available' && 
        day.price && 
        parseFloat(day.price) > 0
      );
      
      availableDaysCount = availableDays.length;
      
      if (availableDays.length > 0) {
        const total = availableDays.reduce((sum, day) => sum + parseFloat(day.price), 0);
        calculatedAverage = Math.round(total / availableDays.length);
      }
    }
    
    return {
      listingInfo: {
        id: listing.id,
        name: listing.name,
        rackRatePrice: listing.price
      },
      calendarAPITest: {
        url: calendarUrl,
        status: calendarStatus,
        statusText: calendarResponse.statusText,
        totalDays: totalDaysCount,
        availableDays: availableDaysCount,
        calculatedAverage: calculatedAverage,
        sampleDays: calendarData?.result?.slice(0, 5) || []
      },
      conclusion: calculatedAverage 
        ? `✅ Calculated average: $${calculatedAverage} (from ${availableDaysCount} available days)`
        : `❌ Failed to calculate average. Falling back to rack rate: $${listing.price}`
    };
    
  } catch (error) {
    return { 
      error: error.message,
      stack: error.stack 
    };
  }
}
__name(testPricingCalculation, "testPricingCalculation");

export {
  index_default as default
};
