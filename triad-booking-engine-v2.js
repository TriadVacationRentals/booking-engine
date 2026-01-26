const container = document.querySelector('[data-listing-id]');
const listingIdFromAttribute = container?.dataset?.listingId;

// NEW: Get booking-engine-active status
const isBookingActive = container?.dataset?.bookingActive;

// Require listing ID - no fallback
if (!container || !listingIdFromAttribute) {
    console.error('❌ FATAL ERROR: Missing data-listing-id attribute on container element');
    document.body.innerHTML = '<div style="padding: 40px; text-align: center; font-family: sans-serif;"><h1>Configuration Error</h1><p>Missing listing ID. Please add data-listing-id attribute to the container.</p></div>';
    throw new Error('Missing required data-listing-id attribute');
}

const CONFIG = {
    listingId: parseInt(listingIdFromAttribute),
    workerUrl: 'https://hostaway-proxy.triad-sync.workers.dev',
    maxGuests: 12,
    isBookingActive: isBookingActive === 'true' || isBookingActive === '1'
};

let state = {
    checkIn: null,
    checkOut: null,
    guests: 1,
    calendarData: {},
    currentMonth: new Date(),
    isSelectingCheckout: false,
    avgPricePerNight: null,
    minNights: 2,
    refundableDamageDeposit: 0
};

document.addEventListener('DOMContentLoaded', init);

function init() {
    // NEW: Check if booking is disabled - show overlay and stop
    if (!CONFIG.isBookingActive) {
        showNotBookableOverlay();
        return;
    }
    
    if (window.innerWidth <= 767) {
        const bookingWidget = document.getElementById('bookingWidget');
        const panelContent = document.getElementById('panelContent');
        panelContent.appendChild(bookingWidget);
        bookingWidget.style.display = 'block';
        bookingWidget.style.boxShadow = 'none';
        bookingWidget.style.padding = '0';
        bookingWidget.style.borderRadius = '0';
    }
    
    document.getElementById('checkOutBox').classList.add('disabled');
    
    document.getElementById('checkInBox').onclick = toggleCalendar;
    document.getElementById('checkOutBox').onclick = function() {
        if (!this.classList.contains('disabled')) {
            toggleCalendar();
        }
    };
    document.getElementById('guestBox').onclick = toggleGuests;
    document.getElementById('guestMinus').onclick = () => changeGuests(-1);
    document.getElementById('guestPlus').onclick = () => changeGuests(1);
    document.getElementById('bookBtn').onclick = handleBook;
    
    document.getElementById('panelHeader').addEventListener('click', function(e) {
        if (e.target.id !== 'closeBtn') togglePanel();
    });
    
    document.getElementById('closeBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        closePanel();
    });
    
    document.getElementById('bookingOverlay').addEventListener('click', closePanel);
    
    loadCalendar();
    updateGuestControls();
    fetchAveragePrice();
    fetchListingDetails().then(() => {
        updateGuestControls();
    });
}

// NEW FUNCTION: Show not bookable overlay
function showNotBookableOverlay() {
    console.log('🚫 Booking engine is disabled for this property');
    
    const bookingWidget = document.getElementById('bookingWidget');
    
    // Grey out ALL children of the widget FIRST
    Array.from(bookingWidget.children).forEach(child => {
        child.style.opacity = '0.2';
        child.style.pointerEvents = 'none';
    });
    
    // Create overlay AFTER (so it's not affected by opacity)
    const overlay = document.createElement('div');
    overlay.id = 'notBookableOverlay';
    overlay.innerHTML = `
        <div class="not-bookable-message">This property is not available at the moment.</div>
    `;
    
    bookingWidget.appendChild(overlay);
}

function togglePanel() {
    const panel = document.getElementById('bookingPanel');
    const overlay = document.getElementById('bookingOverlay');
    
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        overlay.classList.remove('open');
        document.body.style.overflow = '';
    } else {
        panel.classList.add('open');
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closePanel() {
    document.getElementById('bookingPanel').classList.remove('open');
    document.getElementById('bookingOverlay').classList.remove('open');
    document.body.style.overflow = '';
    
    const cal = document.getElementById('calendar');
    const guests = document.getElementById('guestPopup');
    const dateSection = document.querySelector('.date-section');
    const guestSection = document.querySelector('.guest-section');
    
    if (cal.classList.contains('active')) {
        cal.classList.remove('active');
        document.getElementById('checkInBox').classList.remove('active');
        document.getElementById('checkOutBox').classList.remove('active');
    }
    
    if (guests.classList.contains('active')) {
        guests.classList.remove('active');
        document.getElementById('guestBox').classList.remove('active');
    }
    
    const priceDetails = document.getElementById('priceDetails');
    const detailsLink = document.querySelector('.details-link');
    if (priceDetails && priceDetails.classList.contains('expanded')) {
        priceDetails.classList.remove('expanded');
        if (detailsLink) detailsLink.classList.remove('expanded');
    }
    
    dateSection.style.display = 'grid';
    guestSection.style.display = 'block';
}

async function fetchAveragePrice() {
    console.log('🔍 Fetching average price from calendar (90 days)...');
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 90);

    try {
        const res = await fetch(
            `${CONFIG.workerUrl}/api/listings/${CONFIG.listingId}/calendar?startDate=${fmt(start)}&endDate=${fmt(end)}`
        );
        const data = await res.json();
        console.log('📊 Calendar data received:', data);
        
        let total = 0;
        let count = 0;
        data.result.forEach(d => {
            if (d.isAvailable === 1 && d.price) {
                total += parseFloat(d.price);
                count++;
            }
        });
        
        console.log(`📊 Found ${count} available nights in next 90 days`);
        
        if (count > 0) {
            state.avgPricePerNight = Math.round(total / count);
            console.log('✅ Average price calculated:', state.avgPricePerNight);
            updateBottomBarPrice();
        } else {
            console.warn('⚠️ No available dates found in next 90 days - hiding price');
            hideBottomBarPrice();
        }
    } catch (err) {
        console.error('❌ Failed to fetch average price:', err);
        hideBottomBarPrice();
    }
}

async function fetchListingDetails() {
    console.log('🔍 Fetching listing details for ID:', CONFIG.listingId);
    try {
        const url = `${CONFIG.workerUrl}/api/listings/${CONFIG.listingId}`;
        console.log('📡 API URL:', url);
        
        const res = await fetch(url);
        console.log('📥 Response status:', res.status);
        
        const data = await res.json();
        console.log('📦 Response data:', data);
        
        if (data.result && data.result.minNights) {
            state.minNights = data.result.minNights;
            console.log('✅ minNights set to:', state.minNights);
        } else {
            console.warn('⚠️ minNights not found in response, using default:', state.minNights);
        }
        
        if (data.result && data.result.refundableDamageDeposit) {
            state.refundableDamageDeposit = parseFloat(data.result.refundableDamageDeposit);
            console.log('✅ refundableDamageDeposit set to:', state.refundableDamageDeposit);
        } else {
            console.log('ℹ️ No refundableDamageDeposit found (this is normal for listings without damage deposit)');
        }
        
        if (data.result && data.result.personCapacity) {
            CONFIG.maxGuests = parseInt(data.result.personCapacity);
            const guestDescEl = document.querySelector('.guest-desc');
            if (guestDescEl) {
                guestDescEl.textContent = `Maximum ${CONFIG.maxGuests}`;
            }
            console.log('✅ maxGuests set to:', CONFIG.maxGuests);
        } else {
            console.warn('⚠️ maxGuests not found in response, using default:', CONFIG.maxGuests);
        }
    } catch (err) {
        console.error('❌ Failed to fetch listing details:', err);
    }
}

function updateBottomBarPrice() {
    console.log('💰 Updating bottom bar price...');
    const priceEl = document.getElementById('bottomPrice');
    console.log('Price element:', priceEl);
    console.log('avgPricePerNight:', state.avgPricePerNight);
    
    if (priceEl) {
        if (state.avgPricePerNight) {
            const formattedPrice = `Avg. $${formatPrice(state.avgPricePerNight)}`;
            console.log('✅ Setting price to:', formattedPrice);
            priceEl.textContent = formattedPrice;
            
            const bottomPriceContainer = priceEl.closest('.bottom-price');
            if (bottomPriceContainer) {
                bottomPriceContainer.style.display = 'flex';
            }
        } else {
            console.log('⚠️ No avgPricePerNight available');
        }
    }
}

function hideBottomBarPrice() {
    console.log('🚫 Hiding bottom bar price (no availability)');
    const priceEl = document.getElementById('bottomPrice');
    if (priceEl) {
        const bottomPriceContainer = priceEl.closest('.bottom-price');
        if (bottomPriceContainer) {
            bottomPriceContainer.style.display = 'none';
        }
    }
    
    const desktopPriceEl = document.getElementById('pricePerNight');
    if (desktopPriceEl) {
        desktopPriceEl.style.display = 'none';
    }
}

function toggleCalendar() {
    const cal = document.getElementById('calendar');
    const guests = document.getElementById('guestPopup');
    const dateSection = document.querySelector('.date-section');
    const guestSection = document.querySelector('.guest-section');
    
    guests.classList.remove('active');
    document.getElementById('guestBox').classList.remove('active');
    
    if (cal.classList.contains('active')) {
        cal.classList.remove('active');
        document.getElementById('checkInBox').classList.remove('active');
        document.getElementById('checkOutBox').classList.remove('active');
        
        dateSection.style.display = 'grid';
        guestSection.style.display = 'block';
    } else {
        cal.classList.add('active');
        document.getElementById('checkInBox').classList.add('active');
        document.getElementById('checkOutBox').classList.add('active');
        
        dateSection.style.display = 'none';
        guestSection.style.display = 'none';
        
        state.isSelectingCheckout = false;
        loadCalendar();
    }
}

function toggleGuests() {
    const cal = document.getElementById('calendar');
    const guests = document.getElementById('guestPopup');
    const box = document.getElementById('guestBox');
    
    cal.classList.remove('active');
    document.getElementById('checkInBox').classList.remove('active');
    document.getElementById('checkOutBox').classList.remove('active');
    
    if (guests.classList.contains('active')) {
        guests.classList.remove('active');
        box.classList.remove('active');
    } else {
        guests.classList.add('active');
        box.classList.add('active');
    }
}

async function loadCalendar() {
    const month = new Date(state.currentMonth);
    
    await fetchMonth(month);
    
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    await fetchMonth(nextMonth);
    
    renderCalendar();
}

async function fetchMonth(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    try {
        const res = await fetch(
            `${CONFIG.workerUrl}/api/listings/${CONFIG.listingId}/calendar?startDate=${fmt(start)}&endDate=${fmt(end)}`
        );
        const data = await res.json();
        data.result.forEach(d => state.calendarData[d.date] = d);
    } catch (err) {
        showError('Failed to load calendar');
    }
}

function renderCalendar() {
    const month = new Date(state.currentMonth);
    const monthName = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const viewTitle = state.isSelectingCheckout ? 'Select check-out date' : 'Select check-in date';
    const titleColor = state.isSelectingCheckout ? '#16A8EE' : '#0F2C3A';
    
    document.getElementById('calendar').innerHTML = `
        <div style="margin-bottom: 20px;">
            <div style="font-size: 16px; font-weight: 600; color: ${titleColor}; text-align: center; margin-bottom: 16px; padding: 12px; background: ${state.isSelectingCheckout ? '#e8f6fd' : '#f3f4f6'}; border-radius: 8px;">${viewTitle}</div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <button onclick="changeMonth(-1)" style="width: 32px; height: 32px; border: 1px solid #e5e7eb; background: white; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;">←</button>
                <div style="font-size: 16px; font-weight: 600; color: #0F2C3A;">${monthName}</div>
                <button onclick="changeMonth(1)" style="width: 32px; height: 32px; border: 1px solid #e5e7eb; background: white; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;">→</button>
            </div>
        </div>
        <div class="calendar-container">
            ${renderMonth(month)}
        </div>
        <div style="text-align: right; margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
            <button id="clearDatesBtn" onclick="clearDates()" style="background: none; border: none; color: #9ca3af; font-size: 14px; font-weight: 500; cursor: not-allowed; padding: 8px 16px; border-radius: 8px; transition: all 0.2s;" disabled>Clear dates</button>
        </div>
    `;

    attachDayListeners();
    updateClearButton();
}

function changeMonth(delta) {
    state.currentMonth.setMonth(state.currentMonth.getMonth() + delta);
    loadCalendar();
}

function clearDates() {
    state.checkIn = null;
    state.checkOut = null;
    state.isSelectingCheckout = false;
    
    document.getElementById('checkOutBox').classList.add('disabled');
    
    updateDateDisplay();
    loadCalendar();
}

function updateClearButton() {
    const btn = document.getElementById('clearDatesBtn');
    if (btn) {
        if (state.checkIn || state.checkOut) {
            btn.disabled = false;
            btn.style.cursor = 'pointer';
            btn.style.color = '#16A8EE';
        } else {
            btn.disabled = true;
            btn.style.cursor = 'not-allowed';
            btn.style.color = '#9ca3af';
        }
    }
}

function attachDayListeners() {
    if (state.isSelectingCheckout) {
        document.querySelectorAll('.day.available, .day.checkout-only.checkout-mode').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                selectDate(el.dataset.date);
            };
        });
    } else {
        document.querySelectorAll('.day.available').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                selectDate(el.dataset.date);
            };
        });
    }
}

function renderMonth(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let html = '<div class="month">';
    html += '<div class="weekdays">';
    ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(d => {
        html += `<div class="weekday">${d}</div>`;
    });
    html += '</div><div class="days">';
    
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="day empty"></div>';
    }
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
        const dayData = state.calendarData[dateStr];
        const isPast = dateStr < todayStr;
        const isAvail = dayData && dayData.isAvailable === 1 && !isPast;
        
        let cls = 'day';
        let tooltip = '';
        
        // FIXED: Checkout mode logic
        if (state.isSelectingCheckout && state.checkIn) {
            const nights = Math.round((new Date(dateStr) - new Date(state.checkIn)) / 86400000);
            
            if (nights < state.minNights) {
                cls += ' checkout-only';
                tooltip = `Minimum ${state.minNights} nights required`;
            } else {
                // Check if the NIGHT BEFORE checkout is available (not checkout day itself)
                const lastNightDate = new Date(dateStr);
                lastNightDate.setDate(lastNightDate.getDate() - 1);
                const lastNightStr = fmt(lastNightDate);
                const lastNightData = state.calendarData[lastNightStr];
                
                if (lastNightData && lastNightData.isAvailable === 1) {
                    cls += ' checkout-only checkout-mode';
                } else {
                    cls += ' unavailable';
                }
            }
        } else if (isAvail) {
            let consecutiveNights = 0;
            for (let i = 0; i < 30; i++) {
                const futureDate = new Date(dateStr);
                futureDate.setDate(futureDate.getDate() + i);
                const futureDateStr = fmt(futureDate);
                const futureDayData = state.calendarData[futureDateStr];
                if (futureDayData && futureDayData.isAvailable === 1) {
                    consecutiveNights++;
                } else {
                    break;
                }
            }
            
            if (consecutiveNights < state.minNights) {
                cls += ' checkout-only';
                tooltip = `Minimum ${state.minNights} nights required`;
            } else {
                cls += ' available';
            }
        } else if (isPast) {
            cls += ' past';
        } else {
            const prevDate = new Date(dateStr);
            prevDate.setDate(prevDate.getDate() - 1);
            const prevDateStr = fmt(prevDate);
            const prevDayData = state.calendarData[prevDateStr];
            const prevWasAvailable = prevDayData && prevDayData.isAvailable === 1;
            
            if (prevWasAvailable) {
                cls += ' checkout-only';
                tooltip = 'Check-in unavailable';
            } else {
                cls += ' unavailable';
            }
        }
        
        if (state.checkIn === dateStr || state.checkOut === dateStr) {
            cls += ' selected';
        } else if (state.checkIn && state.checkOut && dateStr > state.checkIn && dateStr < state.checkOut) {
            cls += ' in-range';
        }
        
        const tooltipAttr = tooltip ? `data-tooltip="${tooltip}"` : '';
        html += `<div class="day ${cls}" data-date="${dateStr}" ${tooltipAttr}>${day}</div>`;
    }
    
    html += '</div></div>';
    return html;
}

function selectDate(dateStr) {
    const dayData = state.calendarData[dateStr];
    const isAvailableForCheckin = dayData && dayData.isAvailable === 1;
    
    if (!state.isSelectingCheckout) {
        if (!isAvailableForCheckin) {
            showError('This date is not available for check-in');
            return;
        }
        state.checkIn = dateStr;
        state.checkOut = null;
        
        document.getElementById('checkOutBox').classList.remove('disabled');
        
        state.isSelectingCheckout = true;
        updateDateDisplay();
        renderCalendar();
    } else {
        if (dateStr <= state.checkIn) {
            showError('Check-out must be after check-in');
            return;
        }
        
        const nights = Math.round((new Date(dateStr) - new Date(state.checkIn)) / 86400000);
        const minNights = state.minNights;
        if (nights < minNights) {
            showError(`Minimum stay is ${minNights} nights`);
            return;
        }
        
        let allAvailable = true;
        const checkIn = new Date(state.checkIn);
        const checkOut = new Date(dateStr);
        
        for (let d = new Date(checkIn); d < checkOut; d.setDate(d.getDate() + 1)) {
            const checkDateStr = fmt(d);
            const checkDayData = state.calendarData[checkDateStr];
            
            if (!checkDayData || checkDayData.isAvailable !== 1) {
                allAvailable = false;
                break;
            }
        }
        
        if (!allAvailable) {
            showError('Some nights in this range are not available');
            return;
        }
        
        state.checkOut = dateStr;
        state.isSelectingCheckout = false;
        updateDateDisplay();
        toggleCalendar();
        calculatePrice();
    }
}

function updateDateDisplay() {
    const checkInEl = document.getElementById('checkInDisplay');
    const checkOutEl = document.getElementById('checkOutDisplay');
    
    if (state.checkIn) {
        const d = new Date(state.checkIn);
        checkInEl.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        checkInEl.classList.remove('placeholder');
    } else {
        checkInEl.textContent = 'Add date';
        checkInEl.classList.add('placeholder');
    }
    
    if (state.checkOut) {
        const d = new Date(state.checkOut);
        checkOutEl.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        checkOutEl.classList.remove('placeholder');
    } else {
        checkOutEl.textContent = 'Add date';
        checkOutEl.classList.add('placeholder');
    }
}

function changeGuests(delta) {
    state.guests = Math.max(1, Math.min(CONFIG.maxGuests, state.guests + delta));
    updateGuestControls();
    
    if (state.checkIn && state.checkOut) {
        calculatePrice();
    }
}

function updateGuestControls() {
    const text = state.guests === 1 ? '1 guest' : `${state.guests} guests`;
    document.getElementById('guestDisplay').textContent = text;
    document.getElementById('guestNumber').textContent = state.guests;
    document.getElementById('guestMinus').disabled = state.guests <= 1;
    document.getElementById('guestPlus').disabled = state.guests >= CONFIG.maxGuests;
}

async function calculatePrice() {
    if (!state.checkIn || !state.checkOut) return;
    
    const btn = document.getElementById('bookBtn');
    btn.textContent = 'Calculating...';
    btn.disabled = true;
    
    try {
        const res = await fetch(
            `${CONFIG.workerUrl}/api/listings/${CONFIG.listingId}/calendar/priceDetails`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    startingDate: state.checkIn,
                    endingDate: state.checkOut,
                    numberOfGuests: state.guests,
                    version: 2
                })
            }
        );
        
        const data = await res.json();
        displayPrice(data.result);
        document.getElementById('footer').classList.add('active');
        
        btn.textContent = 'Reserve';
        btn.disabled = false;
    } catch (err) {
        showError('Failed to calculate price');
        btn.textContent = 'Reserve';
        btn.disabled = true;
    }
}

function displayPrice(data) {
    const { totalPrice, components } = data;
    const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
    
    const avgPerNight = Math.round(totalPrice / nights);
    const pricePerNightEl = document.getElementById('pricePerNight');
    pricePerNightEl.querySelector('.desktop-price-amount').textContent = `$${formatPrice(avgPerNight)}`;
    pricePerNightEl.style.display = 'block';
    
    let detailsHtml = '';
    components.forEach(c => {
        if (c.isDeleted === 0 && c.isIncludedInTotalPrice === 1) {
            let label = c.title;
            
            if (c.name === 'baseRate') {
                const perNight = Math.round(c.total / nights);
                label = `$${formatPrice(perNight)} x ${nights} nights`;
            }
            
            const val = Math.round(c.total);
            const discount = c.total < 0;
            
            detailsHtml += `
                <div class="price-line">
                    <span class="price-label">${label}</span>
                    <span class="price-value ${discount ? 'discount' : ''}">${discount ? '-' : ''}$${formatPrice(Math.abs(val))}</span>
                </div>
            `;
        }
    });
    
    if (state.refundableDamageDeposit > 0) {
        detailsHtml += `
            <div class="price-line">
                <span class="price-label">
                    Refundable Damage Deposit
                    <span class="tooltip-icon" title="Either charged at the property or by a credit card hold">?</span>
                </span>
                <span class="price-value">$${formatPrice(state.refundableDamageDeposit)}</span>
            </div>
        `;
    }
    
    detailsHtml += `
        <div class="price-line" style="margin-top: 8px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
            <span class="price-label" style="color: #9ca3af; font-size: 13px; font-style: italic;">
                Discount coupons can be applied during checkout
            </span>
        </div>
    `;
    
    const html = `
        <div class="price-summary">
            <span class="price-summary-label">Total</span>
            <span class="price-summary-value">$${formatPrice(totalPrice)}</span>
        </div>
        <div class="price-details-toggle">
            <button class="details-link" onclick="togglePriceDetails()">Pricing details</button>
        </div>
        <div class="price-details" id="priceDetails">
            ${detailsHtml}
        </div>
    `;
    
    const el = document.getElementById('priceBreakdown');
    el.innerHTML = html;
    el.classList.add('active');
}

function togglePriceDetails() {
    const details = document.getElementById('priceDetails');
    const link = document.querySelector('.details-link');
    
    if (details.classList.contains('expanded')) {
        details.classList.remove('expanded');
        link.classList.remove('expanded');
    } else {
        details.classList.add('expanded');
        link.classList.add('expanded');
    }
}

document.addEventListener('click', function(e) {
    if (e.target.classList.contains('tooltip-icon')) {
        e.preventDefault();
        e.stopPropagation();
        
        if (e.target.classList.contains('show-tooltip')) {
            e.target.classList.remove('show-tooltip');
        } else {
            document.querySelectorAll('.tooltip-icon.show-tooltip').forEach(t => {
                t.classList.remove('show-tooltip');
            });
            e.target.classList.add('show-tooltip');
            
            setTimeout(() => {
                e.target.classList.remove('show-tooltip');
            }, 3000);
        }
    } else {
        document.querySelectorAll('.tooltip-icon.show-tooltip').forEach(t => {
            t.classList.remove('show-tooltip');
        });
    }
});

function handleBook() {
    if (!state.checkIn || !state.checkOut) {
        showError('Please select check-in and check-out dates');
        return;
    }
    
    const checkInDate = state.checkIn;
    const checkOutDate = state.checkOut;
    const guests = state.guests;
    
    const hostawayUrl = `https://properties.triadvacationrentals.com/checkout/${CONFIG.listingId}?start=${checkInDate}&end=${checkOutDate}&numberOfGuests=${guests}`;
    
    console.log('🚀 Redirecting to Hostaway checkout:', hostawayUrl);
    
    window.location.href = hostawayUrl;
}

function showError(msg) {
    const el = document.getElementById('error');
    el.textContent = msg;
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 5000);
}

function closeCalendar() {
    const cal = document.getElementById('calendar');
    const checkInBox = document.getElementById('checkInBox');
    const checkOutBox = document.getElementById('checkOutBox');
    
    if (cal) {
        cal.classList.remove('active');
    }
    
    if (checkInBox) {
        checkInBox.classList.remove('active');
    }
    if (checkOutBox) {
        checkOutBox.classList.remove('active');
    }
    
    const dateSection = document.querySelector('.date-section');
    const guestSection = document.querySelector('.guest-section');
    if (dateSection) dateSection.style.display = 'grid';
    if (guestSection) guestSection.style.display = 'block';
}

function fmt(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n) {
    return String(n).padStart(2, '0');
}

function formatPrice(num) {
    return Math.round(num).toLocaleString('en-US');
}
