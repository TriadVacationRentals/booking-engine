        const container = document.querySelector('[data-listing-id]');
        const listingIdFromAttribute = container?.dataset?.listingId;
        
        // Require listing ID - no fallback
        if (!container || !listingIdFromAttribute) {
            console.error('❌ FATAL ERROR: Missing data-listing-id attribute on container element');
            document.body.innerHTML = '<div style="padding: 40px; text-align: center; font-family: sans-serif;"><h1>Configuration Error</h1><p>Missing listing ID. Please add data-listing-id attribute to the container.</p></div>';
            throw new Error('Missing required data-listing-id attribute');
        }
        
        const CONFIG = {
            listingId: parseInt(listingIdFromAttribute),
            workerUrl: 'https://hostaway-proxy.triad-sync.workers.dev', // Cloudflare Worker - update per environment
            maxGuests: 12 // Default, will be updated from Hostaway API
        };

        let state = {
            checkIn: null,
            checkOut: null,
            guests: 1,
            calendarData: {},
            currentMonth: new Date(),
            isSelectingCheckout: false,
            avgPricePerNight: null,
            minNights: 2, // Default, will be updated from listing
            refundableDamageDeposit: 0 // NEW: Store damage deposit amount
        };

        document.addEventListener('DOMContentLoaded', init);

        function init() {
            // Move booking widget into panel for mobile
            if (window.innerWidth <= 767) {
                const bookingWidget = document.getElementById('bookingWidget');
                const panelContent = document.getElementById('panelContent');
                panelContent.appendChild(bookingWidget);
                bookingWidget.style.display = 'block';
                bookingWidget.style.boxShadow = 'none';
                bookingWidget.style.padding = '0';
                bookingWidget.style.borderRadius = '0';
            }
            
            // Disable checkout initially
            document.getElementById('checkOutBox').classList.add('disabled');
            
            // Booking widget event listeners
            document.getElementById('checkInBox').onclick = toggleCalendar;
            document.getElementById('checkOutBox').onclick = function() {
                // Only allow if check-in is selected
                if (!this.classList.contains('disabled')) {
                    toggleCalendar();
                }
            };
            document.getElementById('guestBox').onclick = toggleGuests;
            document.getElementById('guestMinus').onclick = () => changeGuests(-1);
            document.getElementById('guestPlus').onclick = () => changeGuests(1);
            document.getElementById('bookBtn').onclick = handleBook;
            
            // Mobile panel event listeners
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
            fetchListingDetails();
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
            
            // Reset view - hide calendar, show inputs
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
            
            // Collapse pricing details when closing panel
            const priceDetails = document.getElementById('priceDetails');
            const detailsLink = document.querySelector('.details-link');
            if (priceDetails && priceDetails.classList.contains('expanded')) {
                priceDetails.classList.remove('expanded');
                if (detailsLink) detailsLink.classList.remove('expanded');
            }
            
            // Show all sections
            dateSection.style.display = 'grid';
            guestSection.style.display = 'block';
        }

        async function fetchAveragePrice() {
            console.log('🔍 Fetching average price...');
            const start = new Date();
            const end = new Date();
            end.setDate(end.getDate() + 30);

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
                
                if (count > 0) {
                    state.avgPricePerNight = Math.round(total / count);
                    console.log('✅ Average price calculated:', state.avgPricePerNight);
                    updateBottomBarPrice();
                } else {
                    console.warn('⚠️ No available dates found for price calculation');
                }
            } catch (err) {
                console.error('❌ Failed to fetch average price:', err);
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
                
                // Get minNights
                if (data.result && data.result.minNights) {
                    state.minNights = data.result.minNights;
                    console.log('✅ minNights set to:', state.minNights);
                } else {
                    console.warn('⚠️ minNights not found in response, using default:', state.minNights);
                }
                
                // NEW: Get refundableDamageDeposit
                if (data.result && data.result.refundableDamageDeposit) {
                    state.refundableDamageDeposit = parseFloat(data.result.refundableDamageDeposit);
                    console.log('✅ refundableDamageDeposit set to:', state.refundableDamageDeposit);
                } else {
                    console.log('ℹ️ No refundableDamageDeposit found (this is normal for listings without damage deposit)');
                }
                
                // Get maxGuests from API
                if (data.result && data.result.maxGuests) {
                    CONFIG.maxGuests = parseInt(data.result.maxGuests);
                    // Update UI text
                    const guestDescEl = document.querySelector('.guest-desc');
                    if (guestDescEl) {
                        guestDescEl.textContent = `Maximum ${CONFIG.maxGuests}`;
                    }
                    console.log('✅ maxGuests set to:', CONFIG.maxGuests);
                } else {
                    console.warn('⚠️ maxGuests not found in response, using default:', CONFIG.maxGuests);
                }
                
                // Get base price for bottom bar - show "from $X/night"
                if (data.result && data.result.price) {
                    const basePrice = Math.round(parseFloat(data.result.price));
                    console.log('✅ Base price:', basePrice);
                    
                    // Update bottom bar to show "from $X"
                    const priceEl = document.getElementById('bottomPrice');
                    if (priceEl) {
                        priceEl.textContent = `From $${formatPrice(basePrice)}`;
                        console.log('✅ Bottom bar updated with base price');
                    }
                } else {
                    console.warn('⚠️ price not found in listing details');
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
                    const formattedPrice = `$${formatPrice(state.avgPricePerNight)}`;
                    console.log('✅ Setting price to:', formattedPrice);
                    priceEl.textContent = formattedPrice;
                } else {
                    console.log('⚠️ No avgPricePerNight, trying fallback...');
                    // Fallback: try to get price from desktop display
                    const desktopPrice = document.getElementById('pricePerNight');
                    if (desktopPrice && desktopPrice.querySelector('.desktop-price-amount')) {
                        const price = desktopPrice.querySelector('.desktop-price-amount').textContent;
                        console.log('✅ Using fallback price:', price);
                        priceEl.textContent = price;
                    } else {
                        console.log('❌ No fallback price available');
                    }
                }
            } else {
                console.error('❌ Price element not found!');
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
                
                // Show date and guest sections
                dateSection.style.display = 'grid';
                guestSection.style.display = 'block';
            } else {
                cal.classList.add('active');
                document.getElementById('checkInBox').classList.add('active');
                document.getElementById('checkOutBox').classList.add('active');
                
                // Hide date and guest sections
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
            const dateSection = document.querySelector('.date-section');
            
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
            
            // Load current month
            await fetchMonth(month);
            
            // ALSO load next month to prevent availability issues at month boundaries
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
            
            // Disable checkout box again
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
                
                // CHECKOUT MODE: Check if date meets minimum nights requirement
                if (state.isSelectingCheckout && state.checkIn) {
                    const nights = Math.round((new Date(dateStr) - new Date(state.checkIn)) / 86400000);
                    
                    if (nights < state.minNights) {
                        // Less than minimum nights - use checkout-only class
                        cls += ' checkout-only';
                        tooltip = `Minimum ${state.minNights} nights required`;
                    } else if (isAvail) {
                        // Meets minimum nights AND available - show as blue
                        cls += ' checkout-only checkout-mode';
                    } else {
                        // Meets minimum nights but not available
                        cls += ' unavailable';
                    }
                } else if (isAvail) {
                    // CHECK-IN MODE: Check if there are enough nights available after this date
                    let consecutiveNights = 0;
                    for (let i = 0; i < 30; i++) { // Check up to 30 days ahead
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
                    
                    // If not enough consecutive nights to meet minimum, it's checkout-only
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
                
                // Enable checkout box
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
                const minNights = state.minNights; // Use listing's minNights
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
                
                // Enable the Reserve button
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
            
            // Build detailed breakdown - just display what Hostaway returns
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
            
            // Add damage deposit at the bottom of the breakdown if it exists
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
            
            // Add discount coupon notice at the bottom
            detailsHtml += `
                <div class="price-line" style="margin-top: 8px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                    <span class="price-label" style="color: #9ca3af; font-size: 13px; font-style: italic;">
                        Discount coupons can be applied during checkout
                    </span>
                </div>
            `;
            
            // Build full HTML with summary and collapsible details
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
        
        // Handle tooltip on mobile tap
        document.addEventListener('click', function(e) {
            // If clicking on tooltip icon
            if (e.target.classList.contains('tooltip-icon')) {
                e.preventDefault();
                e.stopPropagation();
                
                // Toggle tooltip
                if (e.target.classList.contains('show-tooltip')) {
                    e.target.classList.remove('show-tooltip');
                } else {
                    // Remove all other tooltips first
                    document.querySelectorAll('.tooltip-icon.show-tooltip').forEach(t => {
                        t.classList.remove('show-tooltip');
                    });
                    e.target.classList.add('show-tooltip');
                    
                    // Auto-hide after 3 seconds
                    setTimeout(() => {
                        e.target.classList.remove('show-tooltip');
                    }, 3000);
                }
            } else {
                // Close all tooltips when clicking elsewhere
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
            
            // Redirect to Hostaway Booking Engine
            const checkInDate = state.checkIn;
            const checkOutDate = state.checkOut;
            const guests = state.guests;
            
            // Hostaway booking engine URL format: /checkout/{listingId}?start=...&end=...&numberOfGuests=...
            // Update base URL (properties.triadvacationrentals.com) per environment if needed
            const hostawayUrl = `https://properties.triadvacationrentals.com/checkout/${CONFIG.listingId}?start=${checkInDate}&end=${checkOutDate}&numberOfGuests=${guests}`;
            
            console.log('🚀 Redirecting to Hostaway checkout:', hostawayUrl);
            
            // Redirect to Hostaway
            window.location.href = hostawayUrl;
        }

        function showError(msg) {
            const el = document.getElementById('error');
            el.textContent = msg;
            el.classList.add('active');
            setTimeout(() => el.classList.remove('active'), 5000);
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
