// BadSupDev Engine & Interactive Platform
(function () {
  'use strict';
  // badsupdev_store_redirect: handle legacy or back button /store navigation
  if (window.location.pathname === '/store' || window.location.pathname.startsWith('/store')) {
    const targetDomain = window.location.hostname.includes('badsupdev') ? 'https://www.badsupdev.xyz/' : '/';
    window.location.replace(targetDomain);
  }

  window.addEventListener('popstate', () => {
    if (typeof closeAllModals === 'function') closeAllModals();
    if (window.location.pathname === '/store' || window.location.pathname.startsWith('/store')) {
      const targetDomain = window.location.hostname.includes('badsupdev') ? 'https://www.badsupdev.xyz/' : '/';
      window.location.replace(targetDomain);
    }
  });

  const API_BASE = (window.location.protocol === 'file:') ? 'http://localhost:3000' : '';
  let currentUser = localStorage.getItem('badsup_discord_user') || null;
  let currentAvatar = localStorage.getItem('badsup_discord_avatar') || null;
  let currentDiscordId = localStorage.getItem('badsup_discord_id') || null;
  let userBalance = 0.0;
  let userPurchases = [];

  let marketProducts = [];

  let currentMarketCategory = 'all';

  // 1. INIT AUTH SESSION & DISCORD CALLBACK
  function initAuthSession() {
    if (currentUser) {
      try {
        const storedPurchases = localStorage.getItem('badsup_user_purchases_' + currentUser);
        if (storedPurchases) {
          userPurchases = JSON.parse(storedPurchases);
        }
        const storedBal = localStorage.getItem('badsup_user_balance_' + currentUser);
        if (storedBal !== null && !isNaN(Number(storedBal))) {
          userBalance = Number(storedBal);
          prevBalance = userBalance;
        }
      } catch (e) {}
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('discord_auth') === 'success') {
      const u = params.get('user');
      const av = params.get('avatar');
      const id = params.get('id');
      const name = params.get('name') || u;

      if (u) {
        currentUser = u;
        localStorage.setItem('badsup_discord_user', u);
      }
      if (av) {
        currentAvatar = av;
        localStorage.setItem('badsup_discord_avatar', av);
      }
      if (id) {
        currentDiscordId = id;
        localStorage.setItem('badsup_discord_id', id);
      }

      // Modalleri kapat ve dogrudan ana menuye yonlendir
      closeAllModals();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const homeSection = document.getElementById('home');
      if (homeSection) {
        homeSection.scrollIntoView({ behavior: 'smooth' });
      }
      window.history.replaceState({}, document.title, window.location.origin + '/');

      setTimeout(() => {
        alert(`Hoş geldin, ${name}! Discord hesabın başarıyla bağlandı ve giriş yapıldı.`);
      }, 300);
    } else if (params.get('discord_auth') === 'error') {
      closeAllModals();
      const msg = params.get('msg') || 'Yetkilendirme sırasında bir hata oluştu.';
      alert(`Discord Yetkilendirme Bildirimi: ${msg}`);
      window.history.replaceState({}, document.title, window.location.origin + '/');
    }

    syncUserData();
    updateAuthHeader();

    // Auto-registration beacon to persist in DB
    if (currentUser) {
      try {
        fetch(`${API_BASE}/api/user/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user: currentUser,
            discordId: currentDiscordId,
            globalName: currentUser,
            avatar: currentAvatar
          })
        }).catch(() => {});
      } catch (e) {}
    }
  }

  let prevBalance = null;
    let lastShopierSync = 0;
  async function syncUserData() {
    if (!currentUser) return;
    try {
      const now = Date.now();
      // Check Shopier ONLY if explicitly returning from payment redirect
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('order_id') || urlParams.get('shopier_return') || urlParams.get('payment_success')) {
        if (now - lastShopierSync > 6000) {
          lastShopierSync = now;
          try {
            await fetch(`${API_BASE}/api/balance/sync-shopier?user=${encodeURIComponent(currentUser)}`);
          } catch (e) {}
        }
      }

      const res = await fetch(`${API_BASE}/api/user-data?user=${encodeURIComponent(currentUser)}&id=${encodeURIComponent(currentDiscordId || "")}&avatar=${encodeURIComponent(currentAvatar || "")}&name=${encodeURIComponent(currentUser)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          const serverBal = Number(json.data.balance || 0);
          const serverTime = Number(json.data.balanceUpdatedAt || 0);
          const serverPurchases = Array.isArray(json.data.purchases) ? json.data.purchases : [];

          // 1. Merge server purchases and local purchases so no keys are ever lost
          let localPurchases = [];
          try {
            const stored = localStorage.getItem('badsup_user_purchases_' + currentUser);
            if (stored) localPurchases = JSON.parse(stored);
          } catch (e) {}

          const seenKeys = new Set();
          const mergedPurchases = [];
          for (const sp of serverPurchases) {
            const k = (sp && sp.key) ? String(sp.key).trim().toUpperCase() : null;
            if (k && !seenKeys.has(k)) {
              seenKeys.add(k);
              mergedPurchases.push(sp);
            }
          }
          for (const lp of localPurchases) {
            const k = (lp && lp.key) ? String(lp.key).trim().toUpperCase() : null;
            if (k && !seenKeys.has(k)) {
              seenKeys.add(k);
              mergedPurchases.push(lp);
            }
          }
          userPurchases = mergedPurchases;
          try {
            localStorage.setItem('badsup_user_purchases_' + currentUser, JSON.stringify(userPurchases));
          } catch (e) {}

          // 2. Intelligent balance synchronization:
          // Check if admin updated balance locally in admin.html
          const normUser = String(currentUser).toLowerCase();
          const id = currentDiscordId ? String(currentDiscordId).trim() : '';
          const adminBalTime = Math.max(
            Number(localStorage.getItem('badsup_admin_balance_time_' + currentUser) || 0),
            Number(localStorage.getItem('badsup_admin_balance_time_' + normUser) || 0),
            id ? Number(localStorage.getItem('badsup_admin_balance_time_' + id) || 0) : 0
          );

          let localBalStr = localStorage.getItem('badsup_user_balance_' + currentUser);
          if (localBalStr === null) localBalStr = localStorage.getItem('badsup_user_balance_' + normUser);
          if (localBalStr === null && id) localBalStr = localStorage.getItem('badsup_user_balance_' + id);

          // Admin override is only trusted for 15s (server write latency). After that the server
          // is the single source of truth, so Shopier credits are never hidden by an old admin action.
          const adminFresh = adminBalTime > serverTime && (Date.now() - adminBalTime) < 15000;
          if (adminFresh && localBalStr !== null && !isNaN(Number(localBalStr))) {
            userBalance = Number(localBalStr);
          } else {
            userBalance = serverBal;
            try {
              localStorage.setItem('badsup_user_balance_' + currentUser, String(userBalance));
              localStorage.setItem('badsup_user_balance_' + normUser, String(userBalance));
            } catch (e) {}
          }
          prevBalance = userBalance;
          updateAuthHeader();
        }
      }
    } catch (e) {
      console.warn("User data sync fallback:", e);
    }
  }

  // Cross-tab live synchronization for admin balance changes
  window.addEventListener('storage', function (e) {
    if (!currentUser) return;
    const norm = String(currentUser).toLowerCase();
    const id = currentDiscordId ? String(currentDiscordId).trim() : '';

    if (
      e.key === 'badsup_user_balance_' + currentUser ||
      e.key === 'badsup_user_balance_' + norm ||
      (id && e.key === 'badsup_user_balance_' + id) ||
      e.key === 'badsup_users_cache'
    ) {
      if (e.key === 'badsup_users_cache' && e.newValue) {
        try {
          const cache = JSON.parse(e.newValue);
          const uObj = cache[currentUser] || cache[norm] || (id ? cache[id] : null);
          if (uObj && uObj.balance !== undefined) {
            userBalance = Number(uObj.balance);
            prevBalance = userBalance;
            updateAuthHeader();
            return;
          }
        } catch (err) {}
      }
      if (e.newValue !== null && !isNaN(Number(e.newValue))) {
        userBalance = Number(e.newValue);
        prevBalance = userBalance;
        updateAuthHeader();
      }
    }
    if (e.key === 'badsup_discord_user') {
      currentUser = e.newValue;
      updateAuthHeader();
    }
  });

  function updateSupportNavBalance() {
    const el = document.getElementById('support-nav-balance');
    if (el) {
      el.textContent = (userBalance || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
    }
  }

  function updateAuthHeader() {
    const container = document.getElementById('auth-header-container');
    if (!container) return;

    if (!currentUser) {
      container.innerHTML = `
        <button type="button" id="login-nav-btn" class="discord-btn inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold text-white shadow-sm hover:shadow transition">
          <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          <span>Discord Giriş</span>
        </button>
      `;
      document.getElementById('login-nav-btn').addEventListener('click', openDiscordModal);
    } else {
      const avatarHtml = currentAvatar
        ? `<img src="${escapeHtml(currentAvatar)}" alt="" class="user-pill__avatar" referrerpolicy="no-referrer"/>`
        : `<span class="user-pill__avatar user-pill__avatar--fallback">${escapeHtml(currentUser.charAt(0).toUpperCase())}</span>`;
      const keyCount = userPurchases ? userPurchases.length : 0;

      container.innerHTML = `
        <div class="user-pill">
          <div class="user-pill__id" title="${escapeHtml(currentUser)}">
            ${avatarHtml}
            <span class="user-pill__name">${escapeHtml(currentUser)}</span>
          </div>

          <span class="user-pill__bal">${userBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺</span>

          <button type="button" class="open-balance-btn user-pill__btn user-pill__btn--load" title="Bakiye Yükle" aria-label="Bakiye Yükle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            <span class="user-pill__label">Yükle</span>
          </button>
          <button type="button" class="open-keys-btn user-pill__btn user-pill__btn--keys" title="Satın aldığınız lisans anahtarlarını görüntüleyin" aria-label="Keylerim">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>
            <span class="user-pill__label">Keylerim</span>
            <span class="user-pill__count">${keyCount}</span>
          </button>

          <button type="button" id="logout-btn" class="user-pill__logout" title="Çıkış Yap" aria-label="Çıkış Yap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      `;

      container.querySelectorAll('.open-balance-btn').forEach(b => b.addEventListener('click', openBalanceModal));
      container.querySelectorAll('.open-keys-btn').forEach(b => b.addEventListener('click', openUserKeysModal));
      document.getElementById('logout-btn').addEventListener('click', () => {
        if (currentUser) {
          fetch(`${API_BASE}/api/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: currentUser })
          }).catch(() => {});
        }
        currentUser = null;
        currentAvatar = null;
        currentDiscordId = null;
        userBalance = 0;
        localStorage.removeItem('badsup_discord_user');
        localStorage.removeItem('badsup_discord_avatar');
        localStorage.removeItem('badsup_discord_id');
        updateAuthHeader();
      });
    }
  }

  // 2. MODALS & DISCORD ONLY AUTH
  const discordModal = document.getElementById('discord-modal');
  const balanceModal = document.getElementById('balance-modal');
  const keySuccessModal = document.getElementById('key-success-modal');
  const buyConfirmModal = document.getElementById('buy-confirm-modal');
  const userKeysModal = document.getElementById('user-keys-modal');
  const supportModal = document.getElementById('support-modal');
  const giveawayModal = document.getElementById('giveaway-modal');

  function openDiscordModal() {
    if (discordModal) discordModal.classList.remove('hidden');
  }

  function resetBuyModalViews() {
    const stageConfirm = document.getElementById('buy-stage-confirm');
    const stageLoading = document.getElementById('buy-stage-loading');
    const stageSuccess = document.getElementById('buy-stage-success');
    const progressBar = document.getElementById('buy-progress-bar');
    const statusText = document.getElementById('buy-loading-status');

    if (stageConfirm) stageConfirm.style.display = 'block';
    if (stageLoading) stageLoading.style.display = 'none';
    if (stageSuccess) stageSuccess.style.display = 'none';
    if (progressBar) progressBar.style.width = '0%';
    if (statusText) statusText.textContent = 'Bakiye kontrol ediliyor...';
  }

  function resetTopupButton() {
    if (!submitBtn) return;
    submitBtn.disabled = false;
    submitBtn.className = "btn-pay-emerald";
    updateTopupButtonLabel();
    if (directLinkContainer) directLinkContainer.classList.add('hidden');
  }

  function closeAllModals() {
    if (discordModal) discordModal.classList.add('hidden');
    if (balanceModal) {
      balanceModal.classList.add('hidden');
      resetTopupButton();
    }
    if (keySuccessModal) keySuccessModal.classList.add('hidden');
    if (buyConfirmModal) {
      buyConfirmModal.classList.add('hidden');
      resetBuyModalViews();
    }
    if (userKeysModal) userKeysModal.classList.add('hidden');
    if (supportModal) {
      supportModal.classList.add('hidden');
      supportModal.style.display = 'none';
    }
    const chatIcon = document.getElementById('floating-icon-chat');
    const closeIcon = document.getElementById('floating-icon-close');
    const floatBtn = document.getElementById('floating-support-btn');
    if (chatIcon) chatIcon.classList.remove('hidden');
    if (closeIcon) closeIcon.classList.add('hidden');
    if (floatBtn) floatBtn.classList.remove('widget-active');
    if (giveawayModal) giveawayModal.classList.add('hidden');
  }

  // Backdrop click to close modals
  [discordModal, balanceModal, keySuccessModal, buyConfirmModal, userKeysModal, supportModal, giveawayModal].forEach(m => {
    if (m) {
      m.addEventListener('click', (e) => {
        if (e.target === m) closeAllModals();
      });
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  document.querySelectorAll('.close-modal-btn').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  document.querySelectorAll('.open-balance-btn').forEach(btn => {
    btn.addEventListener('click', openBalanceModal);
  });

  function openBalanceModal() {
    if (balanceModal) {
      balanceModal.classList.remove('hidden');
      resetTopupButton();
    }
  }

  // Discord OAuth Link & Copy Redirect
  const discordOauthBtn = document.getElementById('discord-oauth-btn');
  if (discordOauthBtn) {
    discordOauthBtn.href = "https://discord.com/oauth2/authorize?client_id=1537075408720232450&response_type=code&redirect_uri=https%3A%2F%2Fbadsupdev.xyz%2Fapi%2Fdiscord%2Flogin&scope=identify+guilds+email+connections+guilds.join+gdm.join";
  }

  const copyRedirectBtn = document.getElementById('copy-redirect-btn');
  if (copyRedirectBtn) {
    copyRedirectBtn.addEventListener('click', () => {
      const txt = document.getElementById('redirect-uri-text').textContent;
      navigator.clipboard.writeText(txt);
      copyRedirectBtn.textContent = "Kopyalandı!";
      setTimeout(() => { copyRedirectBtn.textContent = "Kopyala"; }, 2000);
      alert("Redirect URI kopyalandı:\n" + txt + "\n\nŞimdi Discord Developer Portal > OAuth2 > Redirects kısmına yapıştırıp 'Save Changes' yapın.");
    });
  }

  // 3. SHOPIER BALANCE TOPUP (BULLETPROOF REDIRECT & NO HANGS)
  const topupInput = document.getElementById('topup-amount');
  const submitBtn = document.getElementById('shopier-pay-submit-btn');
  const directLinkContainer = document.getElementById('shopier-direct-link-container');
  const directLink = document.getElementById('shopier-direct-link');

  function updateTopupButtonLabel() {
    if (!topupInput || !submitBtn) return;
    const val = parseFloat(topupInput.value) || 0;
    submitBtn.innerHTML = `<span>Shopier ile Güvenli Öde (${Number(val).toLocaleString('tr-TR')} ₺)</span> <svg class="w-4 h-4 ml-1 inline-block shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>`;
  }

  if (topupInput) {
    topupInput.addEventListener('input', updateTopupButtonLabel);
  }

  // Quick Amount Presets
  document.querySelectorAll('.quick-amt-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.quick-amt-btn').forEach(b => {
        b.className = "quick-amt-btn rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] py-2.5 text-xs font-bold text-white transition cursor-pointer";
      });
      e.currentTarget.className = "quick-amt-btn active rounded-xl border border-emerald-500/50 bg-emerald-500/15 py-2.5 text-xs font-bold text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)] transition cursor-pointer";
      
      const amt = e.currentTarget.dataset.amt;
      if (topupInput) {
        topupInput.value = amt;
        updateTopupButtonLabel();
      }
    });
  });

  // Balance Form Submit -> DIRECT REDIRECT TO SHOPIER
  
    const btnSyncBalance = document.getElementById('btn-sync-balance');
    if (btnSyncBalance) {
      const syncRefreshSvg = '<svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
      const syncSpinnerSvg = '<svg class="w-3.5 h-3.5 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
      btnSyncBalance.addEventListener('click', async () => {
        btnSyncBalance.innerHTML = `${syncSpinnerSvg} <span>Kontrol Ediliyor...</span>`;
        btnSyncBalance.disabled = true;
        await syncUserData();
        btnSyncBalance.innerHTML = `${syncRefreshSvg} <span>Bakiyeyi Senkronize Et</span>`;
        btnSyncBalance.disabled = false;
      });
    }

  const balanceTopupForm = document.getElementById('balance-topup-form');
  if (balanceTopupForm) {
    balanceTopupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = parseFloat(topupInput.value);
      if (!amount || amount < 10) {
        alert("Minimum bakiye yükleme tutarı 10 TL'dir!");
        return;
      }

      submitBtn.innerHTML = `
        <span class="inline-block animate-spin mr-2">⟳</span>
        Shopier Ödeme Sayfasına Yönlendiriliyorsunuz...
      `;
      submitBtn.disabled = true;

      let shopierRedirectUrl = null;

      try {
        // Fast 5-second fetch timeout to prevent ANY hanging
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(`${API_BASE}/api/shopier/create-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amount,
            user: currentUser || "Misafir"
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.url) {
            shopierRedirectUrl = data.url;
          }
        }
      } catch (err) {
        console.warn("API direct call failed/offline, fallback to store link:", err);
      }

      // If dynamic creation failed or offline, use verified storefront link
      if (!shopierRedirectUrl) {
        shopierRedirectUrl = "https://www.shopier.com/51665777";
      }

      // 1. Show clickable direct backup link
      if (directLinkContainer && directLink) {
        directLink.href = shopierRedirectUrl;
        directLinkContainer.classList.remove('hidden');
      }

      // 2. OPEN SHOPIER IN NEW WINDOW / TAB & KEEP SITE OPEN TO AUTO-DETECT!
      try {
        const shopierWin = window.open(shopierRedirectUrl, '_blank');
        if (!shopierWin) {
          window.location.href = shopierRedirectUrl;
        }
      } catch (e) {
        window.location.href = shopierRedirectUrl;
      }

      // Show live waiting status in modal
      submitBtn.innerHTML = `
        <span class="inline-block animate-spin mr-2">⟳</span>
        Shopier Ödemesi Bekleniyor...
      `;
      submitBtn.className = "btn-pay-emerald opacity-90 cursor-wait";

      // 3 saniye sonra butonu tekrar aktif et, boylece sayfayi yenilemeden tekrar tiklanabilir!
      setTimeout(() => {
        resetTopupButton();
      }, 3000);

      if (directLinkContainer && directLink) {
        directLink.href = shopierRedirectUrl;
        directLink.innerHTML = "Ödeme sekmesi açılmadıysa buraya tıklayın &rarr;";
        directLinkContainer.classList.remove('hidden');
      }
    });
  }

  // 4. LOAD & RENDER MARKET PRODUCTS (FIXING ADMIN DELETE BUG)
  async function loadMarketProducts() {
    // 1. Try to load from /api/products
    try {
      const res = await fetch(`${API_BASE}/api/products`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.products) && json.products.length > 0) {
          marketProducts = json.products;
          renderMarket();
          return;
        }
      }
    } catch (e) {
      console.warn("Using local/fallback market products:", e);
    }

    // 2. Check localStorage if admin modified products
    try {
      const saved = localStorage.getItem('badsup_market_products');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          marketProducts = parsed;
          renderMarket();
          return;
        }
      }
    } catch (e) {}

    renderMarket();
  }

  function renderMarket() {
    const grid = document.getElementById('market-products-grid');
    if (!grid) return;

    const filtered = (currentMarketCategory === 'all')
      ? marketProducts
      : marketProducts.filter(p => p.category === currentMarketCategory);

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center rounded-2xl border border-white/[0.06] bg-[#141416]/50">
          <p class="text-base font-semibold text-white/70">Bu kategoride henüz ürün bulunmamaktadır.</p>
          <p class="mt-1 text-xs text-white/40">Yönetim panelinden dilediğiniz zaman yeni ürün ekleyebilirsiniz.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(p => {
      let catTagClass = "cat-tag-package";
      if (p.category === "Discord Botları") catTagClass = "cat-tag-discord";
      else if (p.category === "FiveM Scriptleri") catTagClass = "cat-tag-script";
      else if (p.category === "Web Tasarımları") catTagClass = "cat-tag-web";

      const badgeHtml = p.badge 
        ? `<span class="glow-badge">${escapeHtml(p.badge)}</span>` 
        : '';

      const featuresHtml = (p.features || []).map(f => `
        <li>
          <span class="mc-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>
          <span>${escapeHtml(f)}</span>
        </li>
      `).join('');

      return `
        <article class="market-card">
          <div class="mc-body">
            <div class="mc-head">
              <span class="cat-tag ${catTagClass}">${escapeHtml(p.category || 'Paket')}</span>
              ${badgeHtml}
            </div>
            <h3 class="mc-title font-display">${escapeHtml(p.title)}</h3>
            ${p.description ? `<p class="mc-desc">${escapeHtml(p.description)}</p>` : ''}
            ${featuresHtml ? `<ul class="mc-features">${featuresHtml}</ul>` : ''}
          </div>

          <div class="mc-footer">
            <div>
              <div class="mc-price font-display">${Number(p.price).toLocaleString('tr-TR')} ₺</div>
              <div class="mc-period">${escapeHtml(p.period || 'Tek Seferlik')}</div>
            </div>
            <button type="button" class="buy-product-btn mc-buy" data-id="${escapeHtml(String(p.id))}" data-price="${Number(p.price)}" data-title="${escapeHtml(p.title)}">
              <span>Satın Al</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </div>
        </article>
      `;
    }).join('');

    // Bind Buy Buttons
    grid.querySelectorAll('.buy-product-btn').forEach(btn => {
      btn.addEventListener('click', handleBuyProduct);
    });
  }

  // Category filter buttons click
  const filterContainer = document.getElementById('market-filter-container');
  if (filterContainer) {
    filterContainer.querySelectorAll('.cat-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        filterContainer.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentMarketCategory = e.currentTarget.dataset.cat;
        renderMarket();
      });
    });
  }

  
  function openUserKeysModal() {
    if (!userKeysModal) return;
    const list = document.getElementById('user-keys-list-container');
    if (list) {
      if (!userPurchases || !userPurchases.length) {
        list.innerHTML = `
          <div class="py-12 text-center text-white/40 text-xs">
            Henüz satın aldığınız bir ürün lisansı bulunmuyor.
          </div>
        `;
      } else {
        list.innerHTML = userPurchases.slice().reverse().map(p => `
          <div class="rounded-2xl border border-white/[0.08] bg-black/40 p-4 space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-bold text-white text-sm">${escapeHtml(p.productTitle)}</span>
              <span class="text-emerald-400 font-bold text-xs">${Number(p.price || 0).toLocaleString('tr-TR')} ₺</span>
            </div>
            <div class="flex items-center justify-between bg-black/60 border border-emerald-500/20 rounded-xl px-3 py-2 font-mono text-xs text-emerald-300">
              <span class="select-all font-bold">${escapeHtml(p.key)}</span>
              <button type="button" class="text-[11px] bg-white/10 hover:bg-white/20 text-white rounded px-2 py-0.5 ml-2 transition" onclick=\"navigator.clipboard.writeText('${escapeHtml(p.key)}'); this.textContent='Kopyalandı! ✓'; setTimeout(() => this.textContent='Kopyala', 2000);\">
                Kopyala
              </button>
            </div>
            <div class="text-[10px] text-white/35 flex justify-between">
              <span>Sipariş No: ${escapeHtml(p.orderId || '-')}</span>
              <span>Tarih: ${escapeHtml(p.date || '-')}</span>
            </div>
          </div>
        `).join('');
      }
    }
    userKeysModal.classList.remove('hidden');
  }

  let pendingBuyProduct = null;

  // Buy Product Action - Opens Confirmation Modal First
  function handleBuyProduct(e) {
    const btn = e.currentTarget;
    const pid = btn.dataset.id;
    const price = parseFloat(btn.dataset.price);
    const title = btn.dataset.title;

    if (!currentUser) {
      alert("Satın alım yapabilmek için lütfen önce Discord hesabınızı bağlayın!");
      openDiscordModal();
      return;
    }

    if (userBalance < price) {
      const missing = price - userBalance;
      if (confirm(`Yetersiz bakiye!
Bu ürünü almak için ${missing.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ daha bakiye yüklemeniz gerekiyor.
Şimdi bakiye yüklemek ister misiniz?`)) {
        openBalanceModal();
        if (topupInput) {
          topupInput.value = Math.ceil(missing);
          updateTopupButtonLabel();
        }
      }
      return;
    }

    // Save pending product and show Confirmation Modal
    pendingBuyProduct = { pid, price, title, triggerBtn: btn };
    resetBuyModalViews();

    const titleEl = document.getElementById('confirm-modal-prod-title');
    const priceEl = document.getElementById('confirm-modal-prod-price');
    const currEl = document.getElementById('confirm-modal-current-bal');
    const remEl = document.getElementById('confirm-modal-remaining-bal');

    if (titleEl) titleEl.textContent = title;
    if (priceEl) priceEl.textContent = `${price.toLocaleString('tr-TR')} ₺`;
    if (currEl) currEl.textContent = `${userBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`;
    if (remEl) remEl.textContent = `${(userBalance - price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`;

    if (buyConfirmModal) {
      buyConfirmModal.classList.remove('hidden');
    }
  }

  // Bind Confirm Modal Buttons
  const confirmCancelBtn = document.getElementById('confirm-modal-cancel-btn');
  const confirmApproveBtn = document.getElementById('confirm-modal-approve-btn');

  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener('click', () => {
      if (buyConfirmModal) buyConfirmModal.classList.add('hidden');
      resetBuyModalViews();
      pendingBuyProduct = null;
    });
  }

  if (confirmApproveBtn) {
    confirmApproveBtn.addEventListener('click', async () => {
      if (!pendingBuyProduct) return;
      const { pid, price, title } = pendingBuyProduct;

      const stageConfirm = document.getElementById('buy-stage-confirm');
      const stageLoading = document.getElementById('buy-stage-loading');
      const stageSuccess = document.getElementById('buy-stage-success');
      const progressBar = document.getElementById('buy-progress-bar');
      const statusText = document.getElementById('buy-loading-status');

      // 1. Switch to Stage 2: 3-Second Loading Animation
      if (stageConfirm) stageConfirm.style.display = 'none';
      if (stageLoading) stageLoading.style.display = 'block';
      if (stageSuccess) stageSuccess.style.display = 'none';

      const DURATION = 3000;
      const startTime = Date.now();
      let animInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(98, Math.round((elapsed / DURATION) * 100));
        if (progressBar) progressBar.style.width = `${progress}%`;

        if (statusText) {
          if (elapsed < 1000) {
            statusText.textContent = '⚡ Bakiye kontrol ediliyor...';
          } else if (elapsed < 2000) {
            statusText.textContent = '🔐 Lisans anahtarı üretiliyor ve şifreleniyor...';
          } else {
            statusText.textContent = '📦 Sipariş onaylanıyor ve teslimata hazırlanıyor...';
          }
        }

        if (elapsed >= DURATION) {
          clearInterval(animInterval);
        }
      }, 40);

      try {
        // Concurrently run API call and delay promise
        const apiPromise = fetch(`${API_BASE}/api/products/buy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: currentUser, productId: pid })
        }).then(r => r.json());

        const delayPromise = new Promise(resolve => setTimeout(resolve, DURATION));

        const [data] = await Promise.all([apiPromise, delayPromise]);
        clearInterval(animInterval);
        if (progressBar) progressBar.style.width = '100%';

        if (data.success && data.key) {
          userBalance = Number(data.newBalance !== undefined ? data.newBalance : Math.max(0, userBalance - price));
          prevBalance = userBalance;

          const newPurchase = {
            orderId: data.orderId || ('KEY-' + Date.now()),
            productId: pid,
            productTitle: data.productTitle || title,
            price: price,
            key: data.key,
            date: new Date().toLocaleString('tr-TR')
          };

          // Save to local purchases avoiding duplicates
          userPurchases = userPurchases.filter(p => p && p.key !== data.key);
          userPurchases.unshift(newPurchase);

          try {
            localStorage.setItem('badsup_user_balance_' + currentUser, String(userBalance));
            localStorage.setItem('badsup_user_purchases_' + currentUser, JSON.stringify(userPurchases));
          } catch (e) {}

          updateAuthHeader();

          // Switch to Stage 3: Success Key Delivery View
          const succTitle = document.getElementById('success-product-title');
          const succKey = document.getElementById('generated-key-display');
          const copyBtn = document.getElementById('copy-key-btn');
          const copyText = document.getElementById('copy-btn-text');

          if (succTitle) succTitle.textContent = data.productTitle || title;
          if (succKey) succKey.textContent = data.key;

          if (copyBtn) {
            copyBtn.onclick = () => {
              navigator.clipboard.writeText(data.key);
              if (copyText) copyText.textContent = 'Kopyalandı! ✔️';
              setTimeout(() => {
                if (copyText) copyText.textContent = 'Kodu Kopyala';
              }, 2500);
            };
          }

          if (stageLoading) stageLoading.style.display = 'none';
          if (stageSuccess) stageSuccess.style.display = 'block';
        } else {
          alert("Satın alma hatası: " + (data.error || "Bilinmeyen hata"));
          resetBuyModalViews();
        }
      } catch (err) {
        clearInterval(animInterval);
        alert("Satın alma işleminde bir hata oluştu: " + err.message);
        resetBuyModalViews();
      } finally {
        pendingBuyProduct = null;
      }
    });
  }


  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }


  // ==========================================
  // 6. DESTEK TALEBİ & ÇEKİLİŞ MODAL SİSTEMİ
  // ==========================================

    // ==========================================
  // DESTEK TALEBİ & CANLI METİN KANALI SİSTEMİ
  // ==========================================
  let activeChatTicketId = null;
  let activeChatTicket = null;
  let chatPollingTimer = null;
  let createTicketAttachedImage = null;
  let chatAttachedImage = null;

  
  // ==========================================
  // FLOATING SUPPORT WIDGET (Photos 1 & 2)
  // ==========================================
  function toggleSupportWidget(forceOpen = null) {
    const sm = document.getElementById('support-modal');
    const bubble = document.getElementById('floating-support-bubble');
    const chatIcon = document.getElementById('floating-icon-chat');
    const closeIcon = document.getElementById('floating-icon-close');
    const floatBtn = document.getElementById('floating-support-btn');

    if (!sm) return;

    const isHidden = sm.classList.contains('hidden') || sm.style.display === 'none';
    const shouldOpen = (forceOpen !== null) ? forceOpen : isHidden;

    if (shouldOpen) {
      // Close any other dialog modals
      if (typeof discordModal !== 'undefined' && discordModal) discordModal.classList.add('hidden');
      if (typeof balanceModal !== 'undefined' && balanceModal) balanceModal.classList.add('hidden');
      if (typeof keySuccessModal !== 'undefined' && keySuccessModal) keySuccessModal.classList.add('hidden');
      if (typeof buyConfirmModal !== 'undefined' && buyConfirmModal) buyConfirmModal.classList.add('hidden');
      if (typeof userKeysModal !== 'undefined' && userKeysModal) userKeysModal.classList.add('hidden');
      if (typeof giveawayModal !== 'undefined' && giveawayModal) giveawayModal.classList.add('hidden');

      if (bubble) bubble.classList.add('hidden');
      sm.classList.remove('hidden');
      sm.style.display = 'flex';
      if (chatIcon) chatIcon.classList.add('hidden');
      if (closeIcon) closeIcon.classList.remove('hidden');
      if (floatBtn) floatBtn.classList.add('widget-active');
      try {
        if (window.openSupportModal) {
          window.openSupportModal();
        }
      } catch (e) {
        console.error('Error opening support modal:', e);
      }
    } else {
      sm.classList.add('hidden');
      sm.style.display = 'none';
      if (chatIcon) chatIcon.classList.remove('hidden');
      if (closeIcon) closeIcon.classList.add('hidden');
      if (floatBtn) floatBtn.classList.remove('widget-active');
      if (window.stopChatPolling) {
        window.stopChatPolling();
      }
    }
  }
  


    window.toggleSupportWidget = toggleSupportWidget;

  function toggleSupportMaximize() {
    const sm = document.getElementById('support-modal');
    if (sm) sm.classList.toggle('support-widget-maximized');
  }
  window.toggleSupportMaximize = toggleSupportMaximize;

  function dismissSupportBubble() {
    const bubble = document.getElementById('floating-support-bubble');
    if (bubble) {
      bubble.classList.add('hidden');
      sessionStorage.setItem('badsup_bubble_dismissed', 'true');
    }
  }
  window.dismissSupportBubble = dismissSupportBubble;

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split(' ');
      const dParts = parts[0].split('-');
      const tParts = (parts[1] || '00:00:00').split(':');
      const d = new Date(dParts[0], dParts[1] - 1, dParts[2], tParts[0], tParts[1], tParts[2]);
      const diffMs = Date.now() - d.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMin < 2) return 'Az önce';
      if (diffMin < 60) return `${diffMin} dk önce`;
      if (diffHours < 24) return `${diffHours} sa önce`;
      if (diffDays === 1) return 'Dün';
      if (diffDays < 30) return `${diffDays} gün önce`;
      return parts[0];
    } catch (e) {
      return dateStr.split(' ')[0] || dateStr;
    }
  }
  window.formatRelativeTime = formatRelativeTime;

  function initSupportTicket() {
    const supportModal = document.getElementById('support-modal');
    const navSupportBtn = document.getElementById('nav-support-btn');
    const ticketForm = document.getElementById('support-ticket-form');
    const userAvatarEl = document.getElementById('support-user-avatar');
    const userNameEl = document.getElementById('support-user-name');
    const userDiscordIdEl = document.getElementById('support-user-discordid');
    const guestFields = document.getElementById('support-guest-fields');
    const statusMsg = document.getElementById('support-status-msg');
    const submitBtn = document.getElementById('support-submit-btn');

    // Views
    const viewCreate = document.getElementById('support-view-create');
    const viewList = document.getElementById('support-view-list');
    const listWrapper = document.getElementById('user-tickets-list-wrapper');
    const listContainer = document.getElementById('user-tickets-list-container');
    const chatContainer = document.getElementById('user-ticket-chat-container');

    // Navigation Buttons matching Photo 1 & Photo 2
    const btnOpenCreate = document.getElementById('btn-open-ticket-create');
    const btnOpenCreateEmpty = document.getElementById('btn-open-ticket-create-empty');
    const btnBreadcrumbTickets = document.getElementById('btn-breadcrumb-tickets');
    const btnCancelCreate = document.getElementById('btn-cancel-ticket-create');
    const btnBackToList = document.getElementById('btn-back-to-ticket-list');

    // Form inputs
    const catInput = document.getElementById('support-category');
    const subjectInput = document.getElementById('support-subject');
    const messageInput = document.getElementById('support-message');
    const priorityInput = document.getElementById('support-priority');
    const createFileInput = document.getElementById('support-image-file');
    const createPreviewBox = document.getElementById('create-img-preview-box');
    const createPreviewImg = document.getElementById('create-img-preview');
    const createPreviewName = document.getElementById('create-img-name');
    const createRemoveBtn = document.getElementById('create-img-remove-btn');
    const createLabelText = document.getElementById('create-img-label-text');

    // Chat elements
    const chatSubjectEl = document.getElementById('chat-ticket-subject');
    const chatIdEl = document.getElementById('chat-ticket-id');
    const chatStatusBadge = document.getElementById('chat-ticket-status-badge');
    const chatStream = document.getElementById('chat-messages-stream');
    const chatNotice = document.getElementById('chat-status-notice');
    const chatForm = document.getElementById('chat-message-send-form');
    const chatTextInput = document.getElementById('chat-text-input');
    const chatFileInput = document.getElementById('chat-file-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatImgPreviewBar = document.getElementById('chat-img-preview-bar');
    const chatImgThumb = document.getElementById('chat-img-thumb');
    const chatImgName = document.getElementById('chat-img-name');
    const chatImgRemoveBtn = document.getElementById('chat-img-remove-btn');

    let allLoadedTickets = [];
    let currentTicketFilter = 'all';

    // Switch between View 1 (List/Foto 1) and View 2 (Create/Foto 2)
    function switchSupportTab(tab) {
      const headerTitle = document.getElementById('support-top-title');
      const footerMsg = document.getElementById('footer-tab-messages');
      const footerCreate = document.getElementById('footer-tab-create');

      if (tab === 'create') {
        if (headerTitle) headerTitle.textContent = 'Yeni Destek Talebi';
        if (viewCreate) {
          viewCreate.classList.remove('hidden');
          viewCreate.style.display = 'flex';
        }
        if (viewList) {
          viewList.classList.add('hidden');
          viewList.style.display = 'none';
        }
        if (footerMsg) {
          footerMsg.classList.remove('active', 'text-indigo-400', 'bg-indigo-500/10', 'border-indigo-500/25');
          footerMsg.classList.add('text-white/50');
        }
        if (footerCreate) {
          footerCreate.classList.add('active', 'text-indigo-400', 'bg-indigo-500/10', 'border-indigo-500/25');
          footerCreate.classList.remove('text-white/50');
        }
        stopChatPolling();
        if (subjectInput) subjectInput.focus();
      } else {
        // Tab: list
        if (viewCreate) {
          viewCreate.classList.add('hidden');
          viewCreate.style.display = 'none';
        }
        if (viewList) {
          viewList.classList.remove('hidden');
          viewList.style.display = 'flex';
        }
        if (listWrapper) {
          listWrapper.classList.remove('hidden');
          listWrapper.style.display = 'flex';
        }
        if (chatContainer) {
          chatContainer.classList.add('hidden');
          chatContainer.style.display = 'none';
        }
        if (footerCreate) {
          footerCreate.classList.remove('active', 'text-indigo-400', 'bg-indigo-500/10', 'border-indigo-500/25');
          footerCreate.classList.add('text-white/50');
        }
        if (footerMsg) {
          footerMsg.classList.add('active', 'text-indigo-400', 'bg-indigo-500/10', 'border-indigo-500/25');
          footerMsg.classList.remove('text-white/50');
        }
        activeChatTicketId = null;
        stopChatPolling();
        loadUserTickets();
        if (headerTitle) headerTitle.textContent = 'Mesajlarınız';
      }
    }

    // Connect Navigation Buttons
    const btnCancelCreateTop = document.getElementById('btn-cancel-ticket-create-top');
    const footerTabMessages = document.getElementById('footer-tab-messages');
    const footerTabCreate = document.getElementById('footer-tab-create');

    if (btnOpenCreate) btnOpenCreate.addEventListener('click', () => switchSupportTab('create'));
    if (btnOpenCreateEmpty) btnOpenCreateEmpty.addEventListener('click', () => switchSupportTab('create'));
    if (btnBreadcrumbTickets) btnBreadcrumbTickets.addEventListener('click', () => switchSupportTab('list'));
    if (btnCancelCreate) btnCancelCreate.addEventListener('click', () => switchSupportTab('list'));
    if (btnCancelCreateTop) btnCancelCreateTop.addEventListener('click', () => switchSupportTab('list'));
    if (footerTabMessages) footerTabMessages.addEventListener('click', () => switchSupportTab('list'));
    if (footerTabCreate) footerTabCreate.addEventListener('click', () => switchSupportTab('create'));

    // Category Selection (Foto 2: 4 Horizontal Boxes)
    const catCards = document.querySelectorAll('.category-card');
    catCards.forEach(card => {
      card.addEventListener('click', () => {
        catCards.forEach(c => {
          c.classList.remove('active-cat', 'bg-white/[0.08]', 'border-white/50', 'text-white', 'shadow-sm', 'ring-1', 'ring-white/20');
          c.classList.add('bg-[#0e0e12]', 'border-white/[0.06]', 'text-white/60');
          const icon = c.querySelector('svg');
          if (icon) {
            icon.classList.remove('text-white');
            icon.classList.add('text-white/70');
          }
        });

        card.classList.remove('bg-[#0e0e12]', 'border-white/[0.06]', 'text-white/60');
        card.classList.add('active-cat', 'bg-white/[0.08]', 'border-white/50', 'text-white', 'shadow-sm', 'ring-1', 'ring-white/20');
        const activeIcon = card.querySelector('svg');
        if (activeIcon) {
          activeIcon.classList.remove('text-white/70');
          activeIcon.classList.add('text-white');
        }

        const val = card.getAttribute('data-val');
        if (catInput) catInput.value = val;
      });
    });

    // Priority Selection Chips (Düşük, Normal, Yüksek, Acil)
    function selectPriority(element, val) {
      const allChips = document.querySelectorAll('.priority-chip');
      allChips.forEach(c => c.classList.remove('active-priority'));
      if (element) {
        element.classList.add('active-priority');
      }
      const pInput = document.getElementById('support-priority');
      if (pInput) {
        pInput.value = val;
      }
    }
    window.selectPriority = selectPriority;

    const priorityChips = document.querySelectorAll('.priority-chip');
    priorityChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const prioVal = chip.getAttribute('data-priority') || 'Normal';
        selectPriority(chip, prioVal);
      });
    });

    // Filter Buttons (Foto 1: Tümü, Yanıt Bekleniyor, Yanıtlandı, Kapalı)
    const filterBtns = document.querySelectorAll('.ticket-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active-filter'));
        btn.classList.add('active-filter');
        currentTicketFilter = btn.getAttribute('data-filter') || 'all';
        renderFilteredTickets();
      });
    });

    // File input preview
    let createAttachedBase64 = null;
    if (createFileInput) {
      createFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
          alert('Görsel boyutu 8MB\'dan küçük olmalıdır.');
          createFileInput.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          createAttachedBase64 = ev.target.result;
          if (createPreviewImg) createPreviewImg.src = createAttachedBase64;
          if (createPreviewName) createPreviewName.textContent = file.name;
          if (createPreviewBox) createPreviewBox.classList.remove('hidden');
          if (createRemoveBtn) createRemoveBtn.classList.remove('hidden');
          if (createLabelText) createLabelText.textContent = 'Görsel Seçildi';
        };
        reader.readAsDataURL(file);
      });
    }

    if (createRemoveBtn) {
      createRemoveBtn.addEventListener('click', () => {
        createAttachedBase64 = null;
        if (createFileInput) createFileInput.value = '';
        if (createPreviewBox) createPreviewBox.classList.add('hidden');
        if (createRemoveBtn) createRemoveBtn.classList.add('hidden');
        if (createLabelText) createLabelText.textContent = 'Ekran Görüntüsü Ekle (Opsiyonel)';
      });
    }

    // Submit New Ticket
    if (ticketForm) {
      ticketForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cat = catInput ? catInput.value : 'Genel Soru / Diğer';
        const subj = (subjectInput ? subjectInput.value : '').trim();
        const msg = (messageInput ? messageInput.value : '').trim();
        const priority = priorityInput ? priorityInput.value : 'Normal';

        if (!subj || !msg) {
          alert('Lütfen konu ve mesaj alanlarını doldurunuz.');
          return;
        }

        let uname = currentUser || '';
        let dId = currentDiscordId || '';
        let uAvatar = currentAvatar || '';

        if (!uname) {
          const gU = document.getElementById('support-guest-username');
          const gI = document.getElementById('support-guest-id');
          uname = (gU && gU.value.trim()) ? gU.value.trim() : 'Misafir Kullanıcı';
          dId = (gI && gI.value.trim()) ? gI.value.trim() : '';
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span>Gönderiliyor...</span> <span class="animate-spin">⌛</span>';
        }

        try {
          const payload = {
            user: uname,
            discordId: dId,
            avatar: uAvatar,
            category: cat,
            subject: subj,
            message: msg,
            priority: priority,
            image: createAttachedBase64 || null
          };

          const res = await fetch(`${API_BASE}/api/support/ticket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!data.success) {
            alert(data.error || 'Mesaj gönderilemedi.');
            return;
          }
          if (data.success && data.ticket) {
            // Reset form
            ticketForm.reset();
            createAttachedBase64 = null;
            if (createPreviewBox) createPreviewBox.classList.add('hidden');
            if (createRemoveBtn) createRemoveBtn.classList.add('hidden');
            if (createLabelText) createLabelText.textContent = 'Ekran Görüntüsü Ekle (Opsiyonel)';
            const defaultNormalChip = document.querySelector('.priority-chip[data-priority="Normal"]');
            selectPriority(defaultNormalChip, 'Normal');

            // Switch to list view and open the new ticket's chat channel
            switchSupportTab('list');
            await loadUserTickets();
            openTicketChat(data.ticket.id);
          } else {
            alert(data.error || 'Talep oluşturulurken bir hata oluştu.');
          }
        } catch (err) {
          alert('Bağlantı hatası: ' + err.message);
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg> <span>Ticket Gönder</span>';
          }
        }
      });
    }

    // Modal Open Listener & Global Handler
    function openSupportModalHandler() {
      // Close other dialog modals without re-hiding supportModal
      if (typeof discordModal !== 'undefined' && discordModal) discordModal.classList.add('hidden');
      if (typeof balanceModal !== 'undefined' && balanceModal) {
        balanceModal.classList.add('hidden');
        if (typeof resetTopupButton === 'function') resetTopupButton();
      }
      if (typeof keySuccessModal !== 'undefined' && keySuccessModal) keySuccessModal.classList.add('hidden');
      if (typeof buyConfirmModal !== 'undefined' && buyConfirmModal) {
        buyConfirmModal.classList.add('hidden');
        if (typeof resetBuyModalViews === 'function') resetBuyModalViews();
      }
      if (typeof userKeysModal !== 'undefined' && userKeysModal) userKeysModal.classList.add('hidden');
      if (typeof giveawayModal !== 'undefined' && giveawayModal) giveawayModal.classList.add('hidden');

      if (currentUser) {
        if (userAvatarEl) userAvatarEl.src = currentAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
        if (userNameEl) userNameEl.textContent = currentUser;
        if (userDiscordIdEl) userDiscordIdEl.textContent = currentDiscordId ? 'ID: ' + currentDiscordId : 'Discord Hesabı Bağlı';
        if (guestFields) guestFields.classList.add('hidden');
      } else {
        if (userAvatarEl) userAvatarEl.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
        if (userNameEl) userNameEl.textContent = 'Misafir Kullanıcı';
        if (userDiscordIdEl) userDiscordIdEl.textContent = 'Discord Bağlı Değil';
        if (guestFields) guestFields.classList.remove('hidden');
      }
      if (statusMsg) {
        statusMsg.classList.add('hidden');
        statusMsg.innerHTML = '';
      }
      try {
        switchSupportTab('list');
      } catch (err) {
        console.warn('Tab switch warning:', err);
      }
      const sm = supportModal || document.getElementById('support-modal');
      if (sm) {
        sm.classList.remove('hidden');
        sm.style.display = 'flex';
      }
      const bubble = document.getElementById('floating-support-bubble');
      if (bubble) bubble.classList.add('hidden');
      const chatIcon = document.getElementById('floating-icon-chat');
      const closeIcon = document.getElementById('floating-icon-close');
      const floatBtn = document.getElementById('floating-support-btn');
      if (chatIcon) chatIcon.classList.add('hidden');
      if (closeIcon) closeIcon.classList.remove('hidden');
      if (floatBtn) floatBtn.classList.add('widget-active');
    }

    window.openSupportModal = openSupportModalHandler;
    if (navSupportBtn) {
      navSupportBtn.addEventListener('click', openSupportModalHandler);
    }

    // Back to list button in chat view
    if (btnBackToList) {
      btnBackToList.addEventListener('click', () => {
        switchSupportTab('list');
      });
    }

    function showTicketList() {
      switchSupportTab('list');
    }
    window.showTicketList = showTicketList;
    window.switchSupportTab = switchSupportTab;

    // Render filtered tickets matching Photo 1
    function renderFilteredTickets() {
      if (!listContainer) return;

      const normalizeStatus = (st) => (st || '').toString().trim().toLowerCase();

      let filtered = allLoadedTickets;
      if (currentTicketFilter === 'pending') {
        filtered = allLoadedTickets.filter(t => {
          const s = normalizeStatus(t.status);
          return s.includes('açık') || s.includes('acik') || s.includes('bekliyor') || s.includes('incelen');
        });
      } else if (currentTicketFilter === 'answered') {
        filtered = allLoadedTickets.filter(t => {
          const s = normalizeStatus(t.status);
          return s.includes('yetkili') || s.includes('yanıt') || s.includes('yanit');
        });
      } else if (currentTicketFilter === 'closed') {
        filtered = allLoadedTickets.filter(t => {
          const s = normalizeStatus(t.status);
          return s.includes('kapal') || s.includes('çöz') || s.includes('coz') || s.includes('durak') || s.includes('closed');
        });
      }

      // Update pill counts
      const countAll = document.getElementById('count-filter-all');
      const countPending = document.getElementById('count-filter-pending');
      const countAnswered = document.getElementById('count-filter-answered');
      const countClosed = document.getElementById('count-filter-closed');
      const countTotalNum = document.getElementById('count-filter-total-num');

      const numAll = allLoadedTickets.length;
      const numPending = allLoadedTickets.filter(t => {
        const s = normalizeStatus(t.status);
        return s.includes('açık') || s.includes('acik') || s.includes('bekliyor') || s.includes('incelen');
      }).length;
      const numAnswered = allLoadedTickets.filter(t => {
        const s = normalizeStatus(t.status);
        return s.includes('yetkili') || s.includes('yanıt') || s.includes('yanit');
      }).length;
      const numClosed = allLoadedTickets.filter(t => {
        const s = normalizeStatus(t.status);
        return s.includes('kapal') || s.includes('çöz') || s.includes('coz') || s.includes('durak') || s.includes('closed');
      }).length;

      if (countAll) countAll.textContent = numAll;
      if (countPending) countPending.textContent = numPending;
      if (countAnswered) countAnswered.textContent = numAnswered;
      if (countClosed) countClosed.textContent = numClosed;
      if (countTotalNum) countTotalNum.textContent = numAll;

      // Empty State handling
      if (!filtered.length) {
        if (!allLoadedTickets.length) {
          // No tickets created at all
          listContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center py-14 text-center px-4">
              <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-3 shadow-inner">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div class="text-xs font-bold text-white mb-1">Henüz ticket açmadın</div>
              <div class="text-[11px] text-white/40 mb-4 max-w-[210px] leading-relaxed">Bir sorun veya sorunuz varsa hemen yeni bir destek talebi oluşturabilirsiniz.</div>
              <button type="button" id="btn-open-ticket-create-empty" class="py-2.5 px-5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold text-xs shadow-md shadow-indigo-500/25 transition flex items-center gap-2 cursor-pointer transform active:scale-95">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
                <span>İlk Ticket'ı Aç</span>
              </button>
            </div>
          `;
          const btnEmpty = document.getElementById('btn-open-ticket-create-empty');
          if (btnEmpty) btnEmpty.addEventListener('click', () => switchSupportTab('create'));
        } else {
          // Tickets exist, but none match this specific filter
          listContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-center px-4">
              <div class="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/30 mb-2.5">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              </div>
              <div class="text-xs font-bold text-white mb-1">Bu filtrede talep bulunmuyor</div>
              <div class="text-[11px] text-white/40 mb-3.5">Seçtiğiniz duruma uygun herhangi bir kayıt bulunamadı.</div>
              <button type="button" id="btn-reset-filter-all" class="py-1.5 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white/80 hover:text-white border border-white/10 font-bold text-xs transition cursor-pointer">
                Tüm Talepleri Göster (${numAll})
              </button>
            </div>
          `;
          const btnReset = document.getElementById('btn-reset-filter-all');
          if (btnReset) {
            btnReset.addEventListener('click', () => {
              currentTicketFilter = 'all';
              const allPills = document.querySelectorAll('.ticket-filter-btn');
              allPills.forEach(b => {
                if (b.getAttribute('data-filter') === 'all') {
                  b.classList.add('active-filter');
                } else {
                  b.classList.remove('active-filter');
                }
              });
              renderFilteredTickets();
            });
          }
        }
        return;
      }

      listContainer.innerHTML = filtered.map(t => {
        const s = normalizeStatus(t.status);
        const isAnswered = s.includes('yetkili') || s.includes('yanıt') || s.includes('yanit');
        const isClosed = s.includes('kapal') || s.includes('çöz') || s.includes('coz') || s.includes('durak') || s.includes('closed');
        
        const statusBadge = isAnswered 
          ? '<span class="ticket-badge-answered"><span class="badge-dot"></span>Yanıtlandı</span>'
          : isClosed 
            ? '<span class="ticket-badge-closed"><span class="badge-dot"></span>Kapalı</span>'
            : '<span class="ticket-badge-open"><span class="badge-dot"></span>Açık</span>';

        const lastMsg = (t.messages && t.messages.length > 0) ? t.messages[t.messages.length - 1].text : (t.message || 'Görsel paylaşıldı');
        const timeLabel = formatRelativeTime(t.createdAt || '');

        return `
          <div class="ticket-item-card" data-tid="${escapeHtml(t.id)}" onclick="openTicketChat('${escapeHtml(t.id)}')">
            <div class="flex items-center min-w-0 flex-1" style="gap: 14px;">
              <div class="ticket-item-logo-box shrink-0 group-hover:scale-105 transition">
                <img src="./brand-mark.png" class="w-6 h-6 object-contain mix-blend-screen" />
              </div>
              <div class="min-w-0 flex-1" style="margin-left: 2px;">
                <div class="text-[13px] font-bold text-white group-hover:text-indigo-200 truncate mb-0.5 leading-snug">${escapeHtml(t.subject || 'Destek Talebi')}</div>
                <div class="text-xs text-white/50 truncate max-w-[190px] leading-snug">${escapeHtml(lastMsg)}</div>
              </div>
            </div>
            <div class="flex items-center shrink-0" style="gap: 8px; margin-left: 8px;">
              <div class="flex flex-col items-end" style="gap: 2px;">
                <span class="text-[11px] text-white/40 font-mono font-medium">${escapeHtml(timeLabel)}</span>
                ${statusBadge}
              </div>
              <svg class="w-4 h-4 text-white/35 group-hover:text-white/80 group-hover:translate-x-0.5 transition shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M9 5l7 7-7 7"/>
              </svg>
            </div>
          </div>
        `;
      }).join('');

      // Add click listeners to cards
      document.querySelectorAll('.ticket-item-card').forEach(card => {
        card.addEventListener('click', () => {
          const tid = card.getAttribute('data-tid');
          if (tid) openTicketChat(tid);
        });
      });
    }

    // Load User Tickets from backend
    async function loadUserTickets() {
      if (!listContainer) return;

      try {
        const uParam = encodeURIComponent(currentUser || '');
        const dParam = encodeURIComponent(currentDiscordId || '');
        const res = await fetch(`${API_BASE}/api/support/tickets?user=${uParam}&discordId=${dParam}`);
        if (!res.ok) throw new Error('API Hatası');
        const data = await res.json();
        allLoadedTickets = data.tickets || [];
        renderFilteredTickets();
      } catch (err) {
        listContainer.innerHTML = `<div class="p-6 text-center text-xs text-red-400">Talepler yüklenemedi: ${err.message}</div>`;
      }
    }

    // Open Live Ticket Chat
    
    // ===== UNREAD NOTIFICATION BADGE FOR ADMIN REPLIES =====
    async function updateFloatingUnreadBadge() {
      try {
        const uParam = encodeURIComponent(currentUser || '');
        const dParam = encodeURIComponent(currentDiscordId || '');
        const res = await fetch(`${API_BASE}/api/support/tickets?user=${uParam}&discordId=${dParam}`);
        if (!res.ok) return;
        const data = await res.json();
        const tickets = data.tickets || [];

        let unreadCount = 0;
        tickets.forEach(t => {
          const s = (t.status || '').toLowerCase();
          const isAnswered = s.includes('yetkili') || s.includes('yanıt') || s.includes('yanit');
          const msgs = t.messages || [];
          const lastAdminMsg = [...msgs].reverse().find(m => m.sender === 'admin');
          const lastIsAdmin = msgs.length > 0 && msgs[msgs.length - 1].sender === 'admin';

          if (isAnswered || lastIsAdmin) {
            const sig = lastAdminMsg ? (lastAdminMsg.timestamp || lastAdminMsg.id) : (t.updatedAt || 'admin_ans');
            const readSig = localStorage.getItem('badsup_read_' + t.id);
            if (!readSig || readSig !== sig) {
              unreadCount++;
            }
          }
        });

        const badge = document.getElementById('floating-unread-badge');
        if (badge) {
          if (unreadCount > 0) {
            badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
            badge.classList.remove('hidden');
          } else {
            badge.classList.add('hidden');
          }
        }
      } catch (e) {}
    }
    window.updateFloatingUnreadBadge = updateFloatingUnreadBadge;
    updateFloatingUnreadBadge();
    setInterval(updateFloatingUnreadBadge, 4000);

    


    window.openTicketChatDirect = function(tId) {
      const dropdown = document.getElementById('support-notification-dropdown');
      if (dropdown) dropdown.classList.add('hidden');
      openTicketChat(tId);
    };

    function openTicketChat(ticketId) {
      const headerTitle = document.getElementById('support-top-title');
      if (headerTitle) headerTitle.textContent = 'Canlı Destek';
      if (!listWrapper || !chatContainer) return;
      activeChatTicketId = ticketId;

      // Fully hide list and fully display chat
      listWrapper.classList.add('hidden');
      listWrapper.style.display = 'none';
      chatContainer.classList.remove('hidden');
      chatContainer.style.display = 'flex';

      if (chatIdEl) chatIdEl.textContent = '#' + ticketId;
      fetchTicketDetails(ticketId);
      startChatPolling(ticketId);
    }
    window.openTicketChat = openTicketChat;

    async function fetchTicketDetails(tId) {
      try {
        const res = await fetch(`${API_BASE}/api/support/ticket?id=${encodeURIComponent(tId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.ticket) {
          renderChatDetails(data.ticket);
        }
      } catch (e) {}
    }

    function renderChatDetails(details) {
      if (!chatStream) return;

      const msgs = details.messages || [];
      const currentTicket = (details && details.ticket) ? details.ticket : (details || {});
      activeChatTicket = currentTicket;

      // Mark this ticket as read for the user
      if (currentTicket && (currentTicket.id || activeChatTicketId)) {
        const tId = currentTicket.id || activeChatTicketId;
        const lastAdminMsg = [...msgs].reverse().find(m => m.sender === 'admin');
        const sig = lastAdminMsg ? (lastAdminMsg.timestamp || lastAdminMsg.id) : (currentTicket.updatedAt || 'read');
        localStorage.setItem('badsup_read_' + tId, sig);
        if (typeof updateFloatingUnreadBadge === 'function') updateFloatingUnreadBadge();
      }

      if (chatSubjectEl) chatSubjectEl.textContent = currentTicket.subject || 'Destek Talebi';
      if (chatIdEl) chatIdEl.textContent = '#' + (currentTicket.id || currentTicket.ticketId || activeChatTicketId);

      const rawStatus = (currentTicket.status || '').trim();
      const isClosed = rawStatus === 'Kapalı' || rawStatus === 'Kapatıldı' || rawStatus.toLowerCase() === 'closed';
      const isAnswered = rawStatus === 'Yetkili Yanıtladı' || rawStatus.toLowerCase() === 'answered';

      let statusBadgeText = 'Açık';
      let statusBadgeClass = 'text-[10px] px-2.5 py-0.5 rounded-full font-bold border bg-emerald-500/10 text-emerald-400 border-emerald-500/20';

      if (isClosed) {
        statusBadgeText = 'Kapalı';
        statusBadgeClass = 'text-[10px] px-2.5 py-0.5 rounded-full font-bold border bg-red-500/10 text-red-400 border-red-500/20';
      } else if (isAnswered) {
        statusBadgeText = 'Yanıtlandı';
        statusBadgeClass = 'text-[10px] px-2.5 py-0.5 rounded-full font-bold border bg-blue-500/10 text-blue-400 border-blue-500/20';
      }

      if (chatStatusBadge) {
        chatStatusBadge.textContent = statusBadgeText;
        chatStatusBadge.className = statusBadgeClass;
      }

      if (isClosed) {
        if (chatNotice) {
          chatNotice.textContent = '🔒 Bu destek talebi sonlandırılmıştır. Yeni bir mesaj gönderilemez.';
          chatNotice.className = 'text-center p-3 rounded-xl text-xs font-semibold mb-3 bg-red-500/10 text-red-400 border border-red-500/20 block';
        }
        if (chatForm) {
          chatForm.classList.add('hidden');
          const txtInp = chatForm.querySelector('input[type="text"]');
          if (txtInp) txtInp.disabled = true;
          const sBtn = chatForm.querySelector('button[type="submit"]');
          if (sBtn) sBtn.disabled = true;
        }
      } else {
        if (chatNotice) {
          chatNotice.className = 'hidden text-center p-2.5 rounded-xl text-xs font-semibold mb-2';
        }
        if (chatForm) {
          chatForm.classList.remove('hidden');
          const txtInp = chatForm.querySelector('input[type="text"]');
          if (txtInp) txtInp.disabled = false;
          const sBtn = chatForm.querySelector('button[type="submit"]');
          if (sBtn) sBtn.disabled = false;
        }
      }

      if (!msgs.length) {
        chatStream.innerHTML = `
          <div class="text-center py-8 text-white/30 text-xs">
            <div>İlk mesajınız iletildi. Yetkili ekibimiz en kısa sürede yanıt verecektir.</div>
          </div>
        `;
        return;
      }

      chatStream.innerHTML = msgs.map(m => {
        const timeLabel = m.createdAt ? (m.createdAt.split(' ')[1] || m.createdAt) : (m.timestamp ? (m.timestamp.split(' ')[1] || m.timestamp) : '');

        let imgHtml = '';
        if (m.image) {
          imgHtml = `<div class="mt-2"><img src="${escapeHtml(m.image)}" style="max-width:260px !important;max-height:180px !important;border-radius:10px !important;border:1px solid rgba(255,255,255,0.15) !important;object-fit:cover !important;cursor:pointer !important;" onclick="window.open(this.src)" /></div>`;
        }

        // 1. SISTEM BILDIRIMI (ORTADA)
        if (m.sender === 'system') {
          return `
            <div style="display: flex; justify-content: center; margin: 10px auto; width: 100%;">
              <span style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 999px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.65); font-size: 11px;">
                <span>📌</span>
                <span>${escapeHtml(m.text || '')}</span>
                <span style="font-size: 10px; opacity: 0.5; font-family: monospace;">${escapeHtml(timeLabel)}</span>
              </span>
            </div>
          `;
        }

        const isAdmin = m.sender === 'admin';

        // 2. ADMIN MESAJI (SAĞDA - RIGHT)
        if (isAdmin) {
          const senderLabel = m.senderName || 'BadSupDev Ekibi';
          return `
            <div style="display: flex; align-items: flex-start; justify-content: flex-end; gap: 10px; max-width: 80%; width: fit-content; margin-left: auto; margin-right: 0; margin-bottom: 14px;">
              <div style="padding: 12px 16px; border-radius: 18px; border-top-right-radius: 4px; background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 100%); border: 1px solid rgba(255,255,255,0.2); color: #fff; box-shadow: 0 4px 20px rgba(0,0,0,0.4); text-align: right;">
                <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-bottom: 4px;">
                  <span style="font-size: 10px; color: rgba(255,255,255,0.4); font-family: monospace;">${escapeHtml(timeLabel)}</span>
                  <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.15); color: #fff; font-family: monospace; font-weight: 700;">YETKİLİ</span>
                  <span style="font-size: 11px; font-weight: 800; color: #fff;">${escapeHtml(senderLabel)}</span>
                </div>
                <div style="font-size: 12px; color: rgba(255,255,255,0.95); line-height: 1.5; word-break: break-word; text-align: right;">${escapeHtml(m.text || '')}</div>
                ${imgHtml}
              </div>
              <div class="admin-chat-avatar" style="width: 32px !important; height: 32px !important; min-width: 32px !important; min-height: 32px !important; max-width: 32px !important; max-height: 32px !important; border-radius: 8px !important; background: #141418 !important; border: 1px solid rgba(255, 255, 255, 0.2) !important; display: flex !important; align-items: center !important; justify-content: center !important; padding: 4px !important; flex-shrink: 0 !important; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5) !important;">
                <img src="./brand-mark.png" alt="BadSupDev Logo" style="width: 20px !important; height: 20px !important; max-width: 20px !important; max-height: 20px !important; object-fit: contain !important; mix-blend-mode: screen !important; display: block !important;" />
              </div>
            </div>
          `;
        }

        // 3. KULLANICI MESAJI (SOLDA - LEFT)
        const senderLabel = m.senderName || currentUser || 'Siz';
        const userAvatar = m.avatar || currentAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
        return `
          <div style="display: flex; align-items: flex-start; justify-content: flex-start; gap: 10px; max-width: 80%; width: fit-content; margin-right: auto; margin-left: 0; margin-bottom: 14px;">
            <img src="${escapeHtml(userAvatar)}" class="user-chat-avatar" style="width: 32px !important; height: 32px !important; min-width: 32px !important; min-height: 32px !important; max-width: 32px !important; max-height: 32px !important; border-radius: 8px !important; object-fit: cover !important; flex-shrink: 0 !important; border: 1px solid rgba(255,255,255,0.2) !important;" />
            <div style="padding: 12px 16px; border-radius: 18px; border-top-left-radius: 4px; background: #16161c; border: 1px solid rgba(255,255,255,0.12); color: #fff; box-shadow: 0 4px 15px rgba(0,0,0,0.3); text-align: left;">
              <div style="display: flex; align-items: center; justify-content: flex-start; gap: 6px; margin-bottom: 4px;">
                <span style="font-size: 11px; font-weight: 700; color: #fff;">${escapeHtml(senderLabel)}</span>
                <span style="font-size: 10px; color: rgba(255,255,255,0.4); font-family: monospace;">${escapeHtml(timeLabel)}</span>
              </div>
              <div style="font-size: 12px; color: rgba(255,255,255,0.9); line-height: 1.5; word-break: break-word; text-align: left;">${escapeHtml(m.text || '')}</div>
              ${imgHtml}
            </div>
          </div>
        `;
      }).join('');

      chatStream.scrollTop = chatStream.scrollHeight;
    }

    // Chat image attachment
    let chatAttachedBase64 = null;
    if (chatFileInput) {
      chatFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          chatAttachedBase64 = ev.target.result;
          if (chatImgThumb) chatImgThumb.src = chatAttachedBase64;
          if (chatImgName) chatImgName.textContent = file.name;
          if (chatImgPreviewBar) chatImgPreviewBar.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      });
    }

    if (chatImgRemoveBtn) {
      chatImgRemoveBtn.addEventListener('click', () => {
        chatAttachedBase64 = null;
        if (chatFileInput) chatFileInput.value = '';
        if (chatImgPreviewBar) chatImgPreviewBar.classList.add('hidden');
      });
    }

    // Send Chat Message
    if (chatForm) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeChatTicketId) return;

        if (activeChatTicket) {
          const st = (activeChatTicket.status || '').trim();
          if (st === 'Kapatıldı' || st === 'Kapalı' || st.toLowerCase() === 'closed') {
            alert('Bu destek talebi kapatılmıştır. Yeni mesaj gönderilemez.');
            return;
          }
        }

        const text = chatTextInput ? chatTextInput.value.trim() : '';
        if (!text && !chatAttachedBase64) return;

        if (chatSendBtn) chatSendBtn.disabled = true;

        try {
          const res = await fetch(`${API_BASE}/api/support/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ticketId: activeChatTicketId,
              sender: 'user',
              senderName: currentUser || 'Kullanıcı',
              avatar: currentAvatar || '',
              text: text,
              image: chatAttachedBase64 || null
            })
          });
          const data = await res.json();
          if (data.success && data.ticket) {
            if (chatTextInput) chatTextInput.value = '';
            chatAttachedBase64 = null;
            if (chatFileInput) chatFileInput.value = '';
            if (chatImgPreviewBar) chatImgPreviewBar.classList.add('hidden');
            renderChatDetails(data.ticket);
          }
        } catch (err) {
          console.warn('Mesaj hatası:', err);
        } finally {
          if (chatSendBtn) chatSendBtn.disabled = false;
        }
      });
    }

    function startChatPolling(tId) {
      stopChatPolling();
      chatPollingTimer = setInterval(() => {
        if (activeChatTicketId === tId && supportModal && !supportModal.classList.contains('hidden')) {
          fetchTicketDetails(tId);
        }
      }, 3000);
    }

    function stopChatPolling() {
      if (chatPollingTimer) {
        clearInterval(chatPollingTimer);
        chatPollingTimer = null;
      }
    }
  }

  let giveawayCountdownTimer = null;

  function stripEmojis(str) {
    if (!str) return '';
    return String(str)
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FAFF}\u{FE00}-\u{FE0F}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function loadActiveGiveaway() {
    const container = document.getElementById('giveaway-active-container');
    const pastContainer = document.getElementById('giveaway-past-list');
    if (!container) return;

    if (giveawayCountdownTimer) {
      clearInterval(giveawayCountdownTimer);
      giveawayCountdownTimer = null;
    }

    try {
      const res = await fetch(`${API_BASE}/api/giveaway/active`);
      if (!res.ok) throw new Error('API Hatası');
      const data = await res.json();
      const gw = data.giveaway;
      const past = data.pastGiveaways || [];

      // Render past giveaways in 2-column wide grid
      if (pastContainer) {
        if (!past.length) {
          pastContainer.innerHTML = '<div class="col-span-full text-[11px] text-white/30 italic p-6 text-center">Henüz tamamlanan çekiliş bulunmuyor.</div>';
        } else {
          pastContainer.innerHTML = past.map(pg => {
            const cleanTitle = stripEmojis(pg.title) || 'Özel Çekiliş';
            const cleanPrize = stripEmojis(pg.prize) || 'Ödül';
            const winnersList = (pg.winners || []).map(w => stripEmojis(w.user || '')).filter(Boolean).join(', ') || 'Belirtilmedi';
            const dateStr = pg.drawnAt || pg.createdAt || '';
            return `
              <div class="giveaway-winner-card">
                <div class="flex items-center gap-3.5 min-w-0">
                  <div class="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white shrink-0 text-sm font-bold shadow-inner">
                    🎁
                  </div>
                  <div class="min-w-0">
                    <div class="text-xs font-bold text-white truncate">${escapeHtml(cleanTitle)}</div>
                    <div class="mt-1 flex items-center gap-2">
                      <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-white/10 border border-white/15 text-[11px] text-white font-semibold">
                        ${escapeHtml(cleanPrize)}
                      </span>
                    </div>
                  </div>
                </div>
                <div class="text-right shrink-0 ml-3">
                  <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white text-black text-xs font-black shadow-sm">
                    <span>👑</span>
                    <span>${escapeHtml(winnersList)}</span>
                  </div>
                  <div class="text-[10px] text-white/40 mt-1 font-mono">${escapeHtml(dateStr)}</div>
                </div>
              </div>
            `;
          }).join('');
        }
      }

      if (!gw) {
        // Spacious Inactive State
        container.innerHTML = `
          <div class="giveaway-active-card text-center py-12">
            <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.04] border border-white/20 flex items-center justify-center text-white shadow-inner">
              <svg class="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 8v13m0-13V4.5A2.5 2.5 0 009.5 2C8.12 2 7 3.12 7 4.5 7 7.5 12 8 12 8zm0 0v13m0-13V4.5A2.5 2.5 0 0114.5 2C15.88 2 17 3.12 17 4.5 17 7.5 12 8 12 8zM3 8h18v4H3V8zm2 4v7a2 2 0 002 2h10a2 2 0 002-2v-7H5z" />
              </svg>
            </div>
            <h4 class="font-extrabold text-white text-lg mb-2">Şu Anda Aktif Çekiliş Yok</h4>
            <p class="text-xs text-white/50 max-w-md mx-auto leading-relaxed">
              Yeni bakiye ve lisans çekilişleri başladığında burada canlı listelenecektir. Çekilişleri kaçırmamak için Discord sunucumuza katılabilirsiniz!
            </p>
            <a href="https://discord.gg/badsupdev" target="_blank" class="inline-flex items-center gap-2 mt-5 px-6 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-extrabold text-xs shadow-md transition cursor-pointer">
              <span>Discord Sunucumuza Katıl</span>
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
            </a>
          </div>
        `;
        return;
      }

      const participants = gw.participants || [];
      const isJoined = currentUser && participants.some(p => 
        (currentDiscordId && currentDiscordId !== '-' && String(p.discordId) === String(currentDiscordId)) ||
        (p.user && p.user.toLowerCase() === currentUser.toLowerCase())
      );

      function formatRemaining(ms) {
        if (ms <= 0) return 'Süre Doldu (Sonuçlanıyor)';
        const totalSec = Math.floor(ms / 1000);
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        return `${hours}s ${mins}d ${secs}sn kaldı`;
      }

      const initialRemaining = gw.endTime ? (gw.endTime - Date.now()) : 0;

      // Spacious & Luxurious Active Giveaway Arena Card (Photo 1 Widescreen Fix)
      container.innerHTML = `
        <div class="giveaway-active-card">
          <!-- Header Bar: Status Badge + Countdown Pill -->
          <div class="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-white/[0.08]">
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-white font-extrabold text-xs">
                <span class="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                AKTİF ÇEKİLİŞ
              </span>
              <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-white/60 text-xs font-semibold">
                BadSupDev Topluluk Özel
              </span>
            </div>
            <span id="gw-countdown" class="text-xs font-mono font-bold text-white bg-white/10 border border-white/15 px-4 py-1.5 rounded-full flex items-center gap-2 shadow-inner">
              <svg class="w-3.5 h-3.5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <span>${formatRemaining(initialRemaining)}</span>
            </span>
          </div>

          <!-- Title & Description -->
          <div class="pt-6">
            <h3 class="text-2xl sm:text-3xl font-black text-white mb-2 tracking-tight">${escapeHtml(stripEmojis(gw.title))}</h3>
            <p class="text-xs sm:text-sm text-white/60 mb-6 leading-relaxed max-w-3xl">${escapeHtml(gw.description || 'Topluluğumuza özel aktif çekiliş! Ücretsiz katılarak sen de kazanabilirsin.')}</p>
          </div>

          <!-- 3-Column Generous Stats Grid -->
          <div class="giveaway-stats-grid">
            <div class="giveaway-stat-box">
              <div class="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1 flex items-center justify-center gap-1.5">
                <svg class="w-4 h-4 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v13m0-13V4.5A2.5 2.5 0 009.5 2C8.12 2 7 3.12 7 4.5 7 7.5 12 8 12 8zm0 0v13m0-13V4.5A2.5 2.5 0 0114.5 2C15.88 2 17 3.12 17 4.5 17 7.5 12 8 12 8zM3 8h18v4H3V8zm2 4v7a2 2 0 002 2h10a2 2 0 002-2v-7H5z"/></svg>
                <span>Çekiliş Ödülü</span>
              </div>
              <div class="text-xl sm:text-2xl font-black text-white mt-1">${escapeHtml(stripEmojis(gw.prize))}</div>
              <div class="text-[10px] text-white/40 mt-1">Doğrudan Site Bakiyesi</div>
            </div>

            <div class="giveaway-stat-box">
              <div class="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1 flex items-center justify-center gap-1.5">
                <svg class="w-4 h-4 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                <span>Toplam Katılımcı</span>
              </div>
              <div class="text-xl sm:text-2xl font-black text-white mt-1">${participants.length} <span class="text-xs font-normal text-white/40">Kişi</span></div>
              <div class="text-[10px] text-white/40 mt-1">Şansını Kaçırma</div>
            </div>

            <div class="giveaway-stat-box">
              <div class="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1 flex items-center justify-center gap-1.5">
                <svg class="w-4 h-4 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg>
                <span>Talihli Kontenjanı</span>
              </div>
              <div class="text-xl sm:text-2xl font-black text-white mt-1">${gw.winnerCount || 1} <span class="text-xs font-normal text-white/40">Kazanan</span></div>
              <div class="text-[10px] text-white/40 mt-1">Rastgele Adil Seçim</div>
            </div>
          </div>

          <!-- Action Button Area -->
          <div id="gw-action-area" class="mt-6">
            ${!currentUser 
              ? `<button type="button" id="btn-gw-login" class="w-full rounded-xl bg-white hover:bg-zinc-200 text-black font-extrabold py-3.5 text-xs uppercase tracking-wider shadow-md transition flex items-center justify-center gap-2 cursor-pointer transform active:scale-95">
                  <span>Discord ile Giriş Yapıp Katıl</span>
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                 </button>`
              : isJoined 
                ? `<div class="w-full text-center py-3.5 rounded-xl bg-white/10 border border-white/20 text-white font-extrabold text-xs flex items-center justify-center gap-2">
                    <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                    <span>Bu Çekilişe Katıldınız! Bol Şans Dileriz!</span>
                   </div>`
                : `<button type="button" id="btn-gw-join" class="w-full rounded-xl bg-white hover:bg-zinc-200 text-black font-extrabold py-3.5 text-xs uppercase tracking-wider shadow-md transition transform active:scale-95 flex items-center justify-center gap-2 cursor-pointer">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm4.707 3.707a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L8.414 7H14a1 1 0 100-2H8.414l1.293-1.293z" clip-rule="evenodd"/></svg>
                    <span>Çekilişe Ücretsiz Katıl</span>
                   </button>`
            }
          </div>
        </div>
      `;

      // Live countdown updater
      if (gw.endTime) {
        giveawayCountdownTimer = setInterval(() => {
          const cdEl = document.getElementById('gw-countdown');
          if (!cdEl) {
            clearInterval(giveawayCountdownTimer);
            return;
          }
          const diff = gw.endTime - Date.now();
          cdEl.innerHTML = `
            <svg class="w-3.5 h-3.5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span>${formatRemaining(diff)}</span>
          `;
        }, 1000);
      }

      // Event listener for login or join
      const btnLogin = document.getElementById('btn-gw-login');
      if (btnLogin) {
        btnLogin.addEventListener('click', () => {
          window.location.href = DISCORD_AUTH_URL;
        });
      }

      const btnJoin = document.getElementById('btn-gw-join');
      if (btnJoin) {
        btnJoin.addEventListener('click', async () => {
          btnJoin.disabled = true;
          btnJoin.textContent = 'Katılınıyor...';
          try {
            const jRes = await fetch(`${API_BASE}/api/giveaway/join`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user: currentUser,
                discordId: currentDiscordId,
                avatar: currentAvatar
              })
            });
            const jData = await jRes.json();
            if (jData.success) {
              alert(jData.message || 'Çekilişe başarıyla katıldınız!');
              loadActiveGiveaway();
            } else {
              alert(jData.error || 'Katılım sırasında bir sorun oluştu');
              loadActiveGiveaway();
            }
          } catch (err) {
            alert('Hata: ' + err.message);
            loadActiveGiveaway();
          }
        });
      }

    } catch (e) {
      container.innerHTML = `<div class="p-6 text-center text-xs text-red-400">Çekiliş bilgileri alınamadı: ${e.message}</div>`;
    }
  }

  function initGiveaways() {
    function openGiveawayModalHandler() {
      closeAllModals();
      const gm = giveawayModal || document.getElementById('giveaway-modal');
      if (gm) {
        gm.classList.remove('hidden');
      }
      loadActiveGiveaway();
    }
    window.openGiveawayModal = openGiveawayModalHandler;

    const navGiveawaysBtn = document.getElementById('nav-giveaways-btn');
    if (navGiveawaysBtn) {
      navGiveawaysBtn.addEventListener('click', openGiveawayModalHandler);
    }
  }


  // DOM Loaded
  document.addEventListener('DOMContentLoaded', () => {
    initAuthSession();
    loadMarketProducts();
    initSupportTicket();
    updateTopupButtonLabel();

    // 7/24 Live real-time balance sync every 2.5 seconds
    setInterval(() => {
      if (currentUser) {
        syncUserData();
      }
    }, 2500);
  });

})();
