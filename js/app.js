(function () {
  // Paste your own Bungie.net API key here. Get one at https://www.bungie.net/en/Application
  // URL of your Cloudflare Worker proxy (see setup guide). The Bungie API key
  // lives server-side in the Worker now — it is never exposed in this file.
  const PROXY_BASE = 'https://d2-armor-proxy.alessioceccarelli95.workers.dev/proxy';
  const SYNC_BASE = PROXY_BASE.replace(/\/proxy\/?$/, '') + '/sync';

  const STORAGE_KEY = 'destiny2-armor-checklist-v6';
  const CLASSES = ['titan', 'hunter', 'warlock'];
  const CLASS_LABEL = { titan: 'Titan', hunter: 'Hunter', warlock: 'Warlock' };
  const CLASS_TYPE_ENUM = { titan: 0, hunter: 1, warlock: 2 };
  const ARMOR_ITEM_TYPE = 2;
  const WEAPON_ITEM_TYPE = 3;
  const SLOTS = ['Helmet', 'Gauntlets', 'Chest armor', 'Leg armor', 'Class item'];
  // Bungie's fixed bucket hashes for each armor slot — used to reliably identify
  // a piece's slot from the manifest itself, instead of guessing from its name.
  const BUCKET_HASHES = {
    'Helmet': 3448274439,
    'Gauntlets': 3551918588,
    'Chest armor': 14239492,
    'Leg armor': 20886954,
    'Class item': 1585787867
  };
  const CLASS_SLOT_NAME = {
    titan: { 'Helmet': 'Helmet', 'Gauntlets': 'Gauntlets', 'Chest armor': 'Plate', 'Leg armor': 'Greaves', 'Class item': 'Mark' },
    hunter: { 'Helmet': 'Mask', 'Gauntlets': 'Grasps', 'Chest armor': 'Vest', 'Leg armor': 'Strides', 'Class item': 'Cloak' },
    warlock: { 'Helmet': 'Hood', 'Gauntlets': 'Gloves', 'Chest armor': 'Robes', 'Leg armor': 'Boots', 'Class item': 'Bond' }
  };

  const SET_BONUSES = {
    'Last Wish — Great Hunt': ['Grenade kills briefly reduce incoming damage.', 'Grenade kills also refund extra Heavy ammo.'],
    'Garden of Salvation — Righteousness': ['Staying near allies improves your reload and handling; extra Health near other wearers.', 'Weapon kills grant melee energy to you and nearby allies.'],
    "Deep Stone Crypt — Legacy's Oath": ['Charged melee kills release a disorienting shockwave.', 'Breaking your shield or casting your Super fires homing micro-missiles.'],
    'Vault of Glass — Aftermath': ['Picking up an Orb primes a burst of bonus Health the next time your shield breaks.', 'Sustained damage while subclass-buffed spawns Orbs of Power.'],
    'Vow of the Disciple — Resonant Fury': ['Taking a powerful melee hit starts instant health regen.', 'Melee hits build stacks that heal you when you swap weapons.'],
    "King's Fall — Deathsinger's Wake": ['Kills on players and powerful enemies grant bonus ammo progress.', 'After a powerful kill, your next shield break turns you invisible.'],
    "Root of Nightmares — Nezarec's Nightmare": ['Finishing debuffed targets has a rising chance to spawn an Orb.', 'Finishing a powerful enemy grants Devour and damage resistance.'],
    "Crota's End — Crota's Memory": ['Melee kills trigger a Thrall-style explosion.', 'Extended time in combat builds flinch and damage resistance.'],
    "Salvation's Edge — Promised": ['Powerful kills grant temporary damage resistance and weapon damage.', 'While buffed, damage occasionally unleashes a burst that weakens targets.'],
    'The Desert Perpetual — Collective Psyche': ['Picking up ammo speeds weapon swapping, stacking over time.', 'Debuffs and healing effects you apply last longer.'],
    'Epic Desert Perpetual — Wayward Psyche': ['Picking up ammo reloads your stowed Special weapon.', 'Super damage starts regenerating health and shields while moving; more Super damage refreshes it.'],
    'Pantheon — Pantheos Resplendent': ['Picking up ammo grants Armor Charge, each stack boosting Health.', 'Sustained damage on tough enemies stacks bonus weapon damage, consumed on kill.'],
    "Shattered Throne — Techeun's Regalia": ['Finishers grant an overshield and slow nearby enemies.', 'Damage or kills build stacking damage resistance, sped up by finishers.'],
    "Pit of Heresy — Apostate's Blade": ['Finishers store power that heals you next time your shield breaks.', 'While buffed with Radiant, Restoration, or Cure, melee hits scorch enemies.'],
    'Prophecy — Coda': ['Light-weapon kills build grenade energy; Dark or Kinetic kills build melee energy.', 'Those kills also grant ability energy directly, plus damage resistance for alternating kills.'],
    'Grasp of Avarice — Echo': ['Picking up ammo, Orbs, elemental pickups, or Tangles reduces damage taken and speeds reloads.', 'Those stacks boost pickup value and Tangle damage, then convert to Orbs on shield break.'],
    'Duality — Deep Explorer': ["Taking damage speeds your current weapon's reload, more damage means more speed.", 'Stowing a weapon heals you based on stacks built up.'],
    'Spire of the Watcher — TM Custom': ['Stowing a weapon after a strong kill heals you and disorients nearby enemies.', 'Freshly drawn weapons hit harder with precision shots for a short time.'],
    'Ghosts of the Deep — Taken King': ['Finishers or revives trigger a ritual that boosts your Super stat.', 'Collecting Orbs during the ritual spawns allied Arc moths on ability kills.'],
    "Warlord's Ruin — Dark Age": ['Melee or Sword hits grant a slowly decaying stack of handling and reload.', 'Using your class ability while stacked creates a healing zone, stronger with more stacks.'],
    "Vesper's Host — Spacewalk": ['Primary weapons deal bonus damage to disoriented enemies.', 'Grenade hits follow up with an extra disorienting pulse.'],
    'Sundered Doctrine — Flain': ['After your shield breaks, your next Threadling hits heal you.', 'Taking damage has a chance to spawn a Threadling.'],
    'Equilibrium — Sage Protector': ['Sword hits return grenade and class energy, more if primed.', 'Briefly guarding with a Sword primes bonus Sword damage and lunge range.'],
    'Crucible — Per Audacia': ['Primary weapon kills stack bonus mobility, range, and handling until you die.', 'Boosted mobility, plus faster sprint and slide distance.'],
    'Crucible — Triumphal Anthem': ['Sliding scoops up nearby ammo and boosts reload and handling.', 'Dealing damage grants improved sliding, which also reduces damage taken.'],
    'Crucible — Wild Anthem': ["Reload speed increases toward the bottom half of your magazine.", 'Reloading boosts handling and flinch resistance; SUROS-origin weapons get bonus range instead.'],
    'Crucible — Last Disciple': ["Primary weapon kills briefly boost that weapon's reload speed.", 'Picking up an Orb grants Special ammo progress.'],
    'Crucible — Disaster Corps': ['Reloading certain primaries after a kill slowly heals you.', 'Low health or healing an ally boosts range, stability, and reload on those weapons.'],
    'Gambit — Cyberserpent Null': ['Sprinting builds a reload and handling buff, extended by kills.', 'While buffed, kills also grant Special ammo, more against tough targets.'],
    'Trials of Osiris — Cruel Electrum': ["When an ally dies, Primary weapons get better handling, reload, and flinch resistance, more if you're alone.", 'Primary weapon kills hide you from radar until you swap weapons.'],
    'Trials of Osiris — New Demotic': ['Sliding grants Primary weapons flinch resistance.', 'Reviving or losing an ally boosts handling and ADS speed.'],
    'Trials of Osiris — Twofold Crown': ['Picking up ammo heals you.', 'Primary weapon kills briefly improve your radar range.'],
    'Iron Banner — Iron Battalion': ['Primary weapons get better handling, reload, and damage scaling with your Weapons stat.', 'Kills while your Super is active refund Super energy when it ends.'],
    'Iron Banner — Iron Panoply': ['Lower health boosts weapon stability and handling; kills while shields are down heal you.', 'Shield breaks grant ammo, flinch resistance, and damage resistance, extended by kills.'],
    'Sparrow Racing League — Circuit': ['Fast movement builds toward faster health regen and a sprint speed boost.', 'Sliding while boosted jolts nearby enemies.'],
    'Pinnacle & Arena Ops — Bushido': ['Kills with a freshly drawn or reloaded weapon heal you.', 'Bow, Shotgun, or Sword kills reduce incoming damage, extended by dealing more damage.'],
    'Pinnacle & Arena Ops — Swordmaster': ["Sword, Glaive, or melee damage weakens the target's outgoing damage.", 'Blocking with Sword or Glaive grants damage resistance right after you drop guard.'],
    'Pinnacle & Arena Ops — Eutechnology': ['Fast Void kills spawn a Void breach.', 'Collecting a breach primes your next Void weapon kill to detonate, stronger if used quickly.'],
    'Fireteam & Solo Ops — Techsec': ['Kinetic damage against shields, overshields, vehicles, and constructs is boosted.', 'Powerful kills or shield breaks with Kinetic damage release a disorienting shockwave.'],
    'Fireteam & Solo Ops — Smoke Jumper': ['Picking up an Orb grants brief, fading damage resistance.', 'Finishing a powerful enemy grants Special ammo and a little healing.'],
    'Fireteam & Solo Ops — Ferropotent': ['Shields starting to regenerate grants flinch and damage resistance.', 'Low on ammo? Kills grant progress toward the next ammo type up.'],
    'Fireteam & Solo Ops — Luminopotent': ['While amplified, Fusion, Linear Fusion, and Heat weapons reload and vent faster.', 'Jolt kills or kills on jolted enemies create Ionic Traces.'],
    'The Tower — Lustrous': ["Being healed boosts your Solar weapons' flinch resistance, handling, and reload.", 'Fast Solar kills heal you.'],
    'EDZ — Wildwood': ['ADS precision kills grant damage resistance until you stop aiming.', 'Any precision kill stacks reload, target acquisition, and bonus damage against regular enemies.'],
    'Cosmodrome — Seventh Seraph': ['AoE, Solar, Seventh Seraph, or IKELOS kills grant Warmind Charges, boosting Weapons and Grenade stats.', 'While charged, strong kills or destroying constructs and Tangles trigger a healing Solar blast.'],
    'Nessus — Exodus Down': ['Shield breaks scoop up nearby Orbs and ammo.', 'Gaining, losing, or spending Armor Charge heals and grants damage resistance, scaled by amount.'],
    'Dreaming City — Reverie Dawn': ['Taking heavy damage quickly grants a protective buff with reload and flinch resistance.', 'That buff heals you when it ends; fast kills end it early.'],
    'Moon — Dreambane': ['Kills on tougher enemies grant a buff boosting grenade and melee stats.', 'While buffed, fast weapon damage or kills heal you.'],
    'Europa — Crystocrene': ['After time out of combat, your next kill grants ammo progress and an Orb.', 'Time out of combat also slowly grants Frost Armor.'],
    "Savathun's Throne World — Veritas": ['Finishers or chained melee kills generate an elemental pickup matching your subclass.', 'Finishing powerful enemies heals you and spawns friendly Void moths.'],
    'Neomuna — Thunderhead': ['Using your grenade or the Nanotech Tracer origin trait grants point-blank damage resistance.', "Killing unraveled targets grants grenade energy, or Special ammo if grenade's already full."],
    'Pale Heart — First Ascent': ['Elemental kills stack bonus Transcendence energy while it is inactive.', 'Using your grenade while Transcendence is active consumes those stacks for extra grenade energy.'],
    'Kepler — Aion Adapter': ['Rocket, Grenade Launcher, or micro-missile kills briefly reduce incoming AoE damage.', 'While that is active, melee damage taken emits one disorienting burst.'],
    'Kepler — Aion Renewal': ['Rocket, Grenade Launcher, or micro-missile kills let sprinting grant a speed boost.', 'Once per activation, sprinting at critical health, suspended, or slowed instantly grants that speed boost.'],
    'Lawless Frontier — Shrewd Survivor': ['Swapping to Heat, SMG, or Hand Cannon boosts handling and accuracy, extended by dealing damage.', 'Kills during that window boost a weapon stat, plus stability, reload, and aim assist for those weapons.'],
    'Lawless Frontier — Thriving Survivor': ["Grenade kills boost Heat weapons' vent speed and stability, and Primary weapons' stability and reload.", 'Multiple Heat or Primary kills boost weapon and grenade stats plus ammo generation for those weapons.']
  };

  const DEFAULT_DATA = [
    { category: 'Raids', sets: [
      'Last Wish — Great Hunt', 'Garden of Salvation — Righteousness', "Deep Stone Crypt — Legacy's Oath",
      'Vault of Glass — Aftermath', 'Vow of the Disciple — Resonant Fury', "King's Fall — Deathsinger's Wake",
      "Root of Nightmares — Nezarec's Nightmare", "Crota's End — Crota's Memory", "Salvation's Edge — Promised",
      'The Desert Perpetual — Collective Psyche', 'Epic Desert Perpetual — Wayward Psyche', 'Pantheon — Pantheos Resplendent'
    ]},
    { category: 'Dungeons', sets: [
      "Shattered Throne — Techeun's Regalia", "Pit of Heresy — Apostate's Blade", 'Prophecy — Coda',
      'Grasp of Avarice — Echo', 'Duality — Deep Explorer', 'Spire of the Watcher — TM Custom',
      'Ghosts of the Deep — Taken King', "Warlord's Ruin — Dark Age", "Vesper's Host — Spacewalk",
      'Sundered Doctrine — Flain', 'Equilibrium — Sage Protector'
    ]},
    { category: 'Competitive', sets: [
      'Crucible — Per Audacia', 'Crucible — Triumphal Anthem', 'Crucible — Wild Anthem',
      'Crucible — Last Disciple', 'Crucible — Disaster Corps', 'Gambit — Cyberserpent Null',
      'Trials of Osiris — Cruel Electrum', 'Trials of Osiris — New Demotic', 'Trials of Osiris — Twofold Crown',
      'Iron Banner — Iron Battalion', 'Iron Banner — Iron Panoply', 'Sparrow Racing League — Circuit'
    ]},
    { category: 'Vanguard Ops', sets: [
      'Pinnacle & Arena Ops — Bushido', 'Pinnacle & Arena Ops — Swordmaster', 'Pinnacle & Arena Ops — Eutechnology',
      'Fireteam & Solo Ops — Techsec', 'Fireteam & Solo Ops — Smoke Jumper', 'Fireteam & Solo Ops — Ferropotent',
      'Fireteam & Solo Ops — Luminopotent'
    ]},
    { category: 'Destinations & world', sets: [
      'The Tower — Lustrous', 'EDZ — Wildwood', 'Cosmodrome — Seventh Seraph', 'Nessus — Exodus Down',
      'Dreaming City — Reverie Dawn', 'Moon — Dreambane', 'Europa — Crystocrene', "Savathun's Throne World — Veritas",
      'Neomuna — Thunderhead', 'Pale Heart — First Ascent', 'Kepler — Aion Adapter', 'Kepler — Aion Renewal',
      'Lawless Frontier — Shrewd Survivor', 'Lawless Frontier — Thriving Survivor'
    ]}
  ];

  function buildDefaultState() {
    return DEFAULT_DATA.map((cat) => ({
      category: cat.category,
      sets: cat.sets.map((setName) => ({
        name: setName,
        pieces: SLOTS.map((slot) => {
          const owned = {}; CLASSES.forEach((c) => (owned[c] = false));
          return { slot: slot, owned: owned, icons: {} };
        })
      }))
    }));
  }

  let data = [];
  let wishlist = [];
  let bonusIcons = {}; // keyed by set name -> { icon2, icon4 }
  let activeClass = 'titan';

  function migrateIfNeeded(raw) {
    try {
      const first = raw[0].sets[0].pieces[0].owned;
      if (typeof first === 'boolean') return buildDefaultState();
      return raw;
    } catch (e) { return buildDefaultState(); }
  }

  const WISHLIST_STORAGE_KEY = 'destiny2-weapon-wishlist-v1';
  const BONUS_ICONS_STORAGE_KEY = 'destiny2-bonus-icons-v1';

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      data = raw ? migrateIfNeeded(JSON.parse(raw)) : buildDefaultState();
    } catch (e) { data = buildDefaultState(); }
    try {
      const rawWish = localStorage.getItem(WISHLIST_STORAGE_KEY);
      wishlist = rawWish ? JSON.parse(rawWish) : [];
    } catch (e) { wishlist = []; }
    try {
      const rawBonus = localStorage.getItem(BONUS_ICONS_STORAGE_KEY);
      bonusIcons = rawBonus ? JSON.parse(rawBonus) : {};
    } catch (e) { bonusIcons = {}; }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(wishlist));
      localStorage.setItem(BONUS_ICONS_STORAGE_KEY, JSON.stringify(bonusIcons));
      queueCloudSave();
      return true;
    }
    catch (e) { console.error('Save error', e); return false; }
  }

  // --- Cross-device sync ---
  const SYNC_CODE_KEY = 'destiny2-checklist-sync-code';

  const SYNC_SECRET_KEY = 'destiny2-checklist-sync-secret';

  const makeSyncCode = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 20);
  const makeSyncSecret = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  function getOrCreateSyncCode() {
    let code = localStorage.getItem(SYNC_CODE_KEY);
    if (!code) {
      code = makeSyncCode();
      localStorage.setItem(SYNC_CODE_KEY, code);
    }
    return code;
  }

  // Chiave segreta del dispositivo: non viene mai mostrata, solo copiata nel codice completo.
  function getOrCreateSyncSecret() {
    let secret = localStorage.getItem(SYNC_SECRET_KEY);
    if (!secret) {
      secret = makeSyncSecret();
      localStorage.setItem(SYNC_SECRET_KEY, secret);
    }
    return secret;
  }

  // Formato del codice completo: "codice:chiave"
  function parsePairing(raw) {
    const m = String(raw || '').trim().match(/^([A-Za-z0-9_-]{8,64}):([A-Za-z0-9_-]{16,128})$/);
    return m ? { code: m[1], secret: m[2] } : null;
  }

  let syncSaveTimer = null;
  function queueCloudSave() {
    clearTimeout(syncSaveTimer);
    syncSaveTimer = setTimeout(pushToCloud, 1200);
  }

  async function pushToCloud() {
    const code = getOrCreateSyncCode();
    const secret = getOrCreateSyncSecret();
    try {
      const res = await fetch(SYNC_BASE + '/' + code, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Secret': secret },
        body: JSON.stringify({ armor: data, wishlist: wishlist, bonusIcons: bonusIcons })
      });
      if (res.status === 401) {
        setSyncStatus('Chiave sync non valida per questo codice', true);
        return false;
      }
      if (!res.ok) throw new Error('status ' + res.status);
      setSyncStatus('Synced ✓', false);
      return true;
    } catch (err) {
      setSyncStatus('Sync failed — saved locally only', true);
      return false;
    }
  }

  // --- Validazione dei dati scaricati dal cloud (prima di sovrascrivere il locale) ---
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const SAFE_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$|^https:\/\/www\.bungie\.net\/[\x21-\x7e]+$/i;
  const isSafeImage = (s) => typeof s === 'string' && s.length <= 300000 && SAFE_IMAGE_RE.test(s);
  const isOptionalImage = (s) => s === undefined || s === null || s === '' || isSafeImage(s);

  function validateArmorRaw(arr) {
    if (!Array.isArray(arr) || arr.length > 200) return false;
    return arr.every((cat) => isObj(cat) && typeof cat.category === 'string' && cat.category.length <= 200 &&
      Array.isArray(cat.sets) && cat.sets.length <= 300 && cat.sets.every((set) => isObj(set) &&
        typeof set.name === 'string' && set.name.length <= 200 &&
        Array.isArray(set.pieces) && set.pieces.length <= 20 && set.pieces.every((p) => isObj(p) &&
          typeof p.slot === 'string' && p.slot.length <= 60 &&
          (typeof p.owned === 'boolean' || (isObj(p.owned) && Object.values(p.owned).every((v) => typeof v === 'boolean'))) &&
          (p.icons === undefined || (isObj(p.icons) && Object.values(p.icons).every(isOptionalImage))))));
  }

  function validateWishlistRaw(arr) {
    if (!Array.isArray(arr) || arr.length > 500) return false;
    return arr.every((e) => isObj(e) &&
      (e.id === undefined || (typeof e.id === 'string' && e.id.length <= 100)) &&
      (e.name === undefined || (typeof e.name === 'string' && e.name.length <= 200)) &&
      isOptionalImage(e.icon) &&
      (e.perks === undefined || (Array.isArray(e.perks) && e.perks.length <= 8 && e.perks.every(isOptionalImage))) &&
      isOptionalImage(e.perk1) && isOptionalImage(e.perk2));
  }

  function validateBonusRaw(obj) {
    return isObj(obj) && Object.keys(obj).length <= 300 &&
      Object.values(obj).every((v) => isObj(v) && isOptionalImage(v.icon2) && isOptionalImage(v.icon4));
  }

  // Ritorna { armorData, wishlistData, bonusIconsData } | null (nessun dato) | { error }.
  // Accetta anche i formati precedenti (array di armor puro).
  async function pullFromCloud(code, secret) {
    let res;
    try {
      res = await fetch(SYNC_BASE + '/' + code, { headers: { 'X-Sync-Secret': secret } });
    } catch (err) {
      return { error: 'network' };
    }
    if (res.status === 404) return null;
    if (res.status === 401) return { error: 'auth' };
    if (!res.ok) return { error: 'status' };

    let json;
    try {
      json = await res.json();
    } catch (err) {
      return { error: 'invalid' };
    }
    if (Array.isArray(json)) json = { armor: json };
    const armor = json.armor === undefined ? [] : json.armor;
    const wishlistRaw = json.wishlist === undefined ? [] : json.wishlist;
    const bonusRaw = json.bonusIcons === undefined ? {} : json.bonusIcons;
    if (!validateArmorRaw(armor) || !validateWishlistRaw(wishlistRaw) || !validateBonusRaw(bonusRaw)) {
      return { error: 'invalid' };
    }
    return {
      armorData: migrateIfNeeded(armor),
      wishlistData: wishlistRaw,
      bonusIconsData: bonusRaw
    };
  }

  function syncErrorMessage(error) {
    if (error === 'auth') return 'Chiave non valida per questo codice: usa il codice completo (codice:chiave)';
    if (error === 'invalid') return 'Dati cloud non validi: nessuna modifica applicata';
    if (error === 'network') return 'Errore di rete: riprova più tardi';
    return 'Errore del server di sync';
  }

  // Rigenera codice e chiave. Il nuovo record viene creato prima; il vecchio solo dopo.
  async function rotateSyncCode() {
    if (!window.confirm('Generare un nuovo codice? Gli altri dispositivi dovranno inserire il nuovo codice completo.')) return;
    const oldCode = getOrCreateSyncCode();
    const oldSecret = getOrCreateSyncSecret();
    const newCode = makeSyncCode();
    const newSecret = makeSyncSecret();
    setSyncStatus('Rigenerazione in corso...', false);
    let created = null;
    try {
      created = await fetch(SYNC_BASE + '/' + newCode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Secret': newSecret },
        body: JSON.stringify({ armor: data, wishlist: wishlist, bonusIcons: bonusIcons })
      });
    } catch (err) {
      created = null;
    }
    if (!created || !created.ok) {
      setSyncStatus('Rigenerazione fallita: codice invariato', true);
      return;
    }
    localStorage.setItem(SYNC_CODE_KEY, newCode);
    localStorage.setItem(SYNC_SECRET_KEY, newSecret);
    renderSyncCodeDisplay();
    let removed = null;
    try {
      removed = await fetch(SYNC_BASE + '/' + oldCode, { method: 'DELETE', headers: { 'X-Sync-Secret': oldSecret } });
    } catch (err) {
      removed = null;
    }
    if (removed && removed.ok) setSyncStatus('Nuovo codice generato ✓', false);
    else setSyncStatus('Nuovo codice creato, ma il vecchio non è stato eliminato', true);
  }

  function setSyncStatus(text, isError) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? 'var(--danger)' : '#8fd6a3';
  }

  function renderSyncCodeDisplay() {
    const el = document.getElementById('sync-code-display');
    if (el) el.textContent = getOrCreateSyncCode();
  }

  // --- Manifest (item database) loading ---
  const loadBanner = document.getElementById('load-banner');
  const loadBannerText = document.getElementById('load-banner-text');
  const loadBarFill = document.getElementById('load-bar-fill');
  const loadBannerDismiss = document.getElementById('load-banner-dismiss');
  function setLoadProgress(fraction, text) {
    loadBanner.classList.remove('success', 'error');
    loadBarFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
    loadBannerText.textContent = text;
  }
  function setLoadSuccess(text) {
    loadBanner.classList.remove('error'); loadBanner.classList.add('success');
    loadBarFill.style.width = '100%'; loadBannerText.textContent = text;
    loadBannerDismiss.style.display = 'inline-block';
  }
  function setLoadError(text) {
    loadBanner.classList.remove('success'); loadBanner.classList.add('error');
    loadBannerText.textContent = text; loadBannerDismiss.style.display = 'inline-block';
  }
  loadBannerDismiss.addEventListener('click', () => { loadBanner.style.display = 'none'; });

  let manifestItems = null;
  let allNamedItems = null;
  let weaponItems = null;
  let itemByHash = null;
  let plugSetsByHash = null;
  let socketCategoryNameByHash = null;
  let seasonInfoByHash = null;
  let powerCapByHash = null;
  let collectibleSourceByHash = null;
  let collectibleParentByHash = null;
  let presentationNodeByHash = null;
  let sandboxPerkByHash = null;
  let manifestPromise = null;

  async function fetchJsonWithProgress(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    const totalStr = res.headers.get('Content-Length');
    const total = totalStr ? parseInt(totalStr, 10) : 0;
    if (!res.body || !total) { const text = await res.text(); onProgress(1); return JSON.parse(text); }
    const reader = res.body.getReader();
    const chunks = []; let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      onProgress(received / total);
    }
    const blob = new Blob(chunks);
    return JSON.parse(await blob.text());
  }

  async function ensureManifestLoaded() {
    if (manifestItems) return manifestItems;
    if (manifestPromise) return manifestPromise;
    manifestPromise = (async () => {
      setLoadProgress(0.02, 'Connecting to Bungie...');
      const idxRes = await fetch(PROXY_BASE + '/Platform/Destiny2/Manifest/');
      if (!idxRes.ok) throw new Error('Manifest index error: ' + idxRes.status);
      const idxJson = await idxRes.json();
      const itemDefPath = idxJson.Response.jsonWorldComponentContentPaths.en.DestinyInventoryItemDefinition;
      const defJson = await fetchJsonWithProgress(PROXY_BASE + itemDefPath, (frac) => {
        setLoadProgress(0.05 + frac * 0.7, 'Downloading item database — ' + Math.round(frac * 100) + '%...');
      });
      setLoadProgress(0.78, 'Indexing items...');
      const all = Object.values(defJson);
      window.__rawArmorDebug = all;
      window.debugFindArmor = function (nameSubstr, limit) {
        limit = limit || 2;
        const q = nameSubstr.toLowerCase();
        const matches = all.filter(
          (it) => it && it.itemType === ARMOR_ITEM_TYPE && it.displayProperties &&
            it.displayProperties.name && it.displayProperties.name.toLowerCase().includes(q)
        );
        matches.slice(0, limit).forEach((it) => {
          console.log('=== ' + it.displayProperties.name + ' (hash ' + it.hash + ') ===');
          console.log('perks:', JSON.stringify(it.perks));

          const cats = (it.sockets && it.sockets.socketCategories) || [];
          const catInfo = cats.map((cat) => ({
            categoryHash: cat.socketCategoryHash,
            categoryName: (socketCategoryNameByHash && socketCategoryNameByHash.get(cat.socketCategoryHash)) || '(unresolved)',
            socketIndexes: cat.socketIndexes
          }));
          console.log('socketCategories (resolved):', JSON.stringify(catInfo, null, 2));

          const entries = (it.sockets && it.sockets.socketEntries) || [];
          const entryInfo = entries.map((entry, idx) => {
            const initial = entry.singleInitialItemHash && itemByHash ? itemByHash.get(entry.singleInitialItemHash) : null;
            const plugSetHash = entry.reusablePlugSetHash || entry.randomizedPlugSetHash;
            let plugPoolNames = [];
            if (plugSetHash && plugSetsByHash && plugSetsByHash.has(plugSetHash)) {
              plugPoolNames = plugSetsByHash.get(plugSetHash)
                .map((h) => (itemByHash && itemByHash.get(h) ? itemByHash.get(h).name : '(hash ' + h + ', unresolved)'));
            }
            return {
              socketIndex: idx,
              singleInitialItemHash: entry.singleInitialItemHash || null,
              singleInitialItemName: initial ? initial.name : null,
              reusablePlugSetHash: entry.reusablePlugSetHash || null,
              randomizedPlugSetHash: entry.randomizedPlugSetHash || null,
              plugPoolNames: plugPoolNames
            };
          });
          console.log('socketEntries (resolved):', JSON.stringify(entryInfo, null, 2));
        });
        return matches;
      };

      // Narrower helper: print ONLY the sockets belonging to the "ARMOR PERKS"
      // category, one console.log per socket, so long plug pools don't get
      // truncated by the browser console's single-line collapsing.
      window.debugResolveHash = function (hash) {
        const item = all.find((i) => i && i.hash === hash);
        if (!item) { console.log('No item found for hash ' + hash); return null; }
        const info = {
          hash: item.hash,
          name: item.displayProperties && item.displayProperties.name,
          description: item.displayProperties && item.displayProperties.description,
          itemTypeDisplayName: item.itemTypeDisplayName,
          plugCategoryIdentifier: item.plug ? item.plug.plugCategoryIdentifier : null,
          plugCategoryHash: item.plug ? item.plug.plugCategoryHash : null,
          redacted: item.redacted
        };
        console.log(JSON.stringify(info, null, 2));
        return item;
      };

      window.debugArmorPerksSockets = function (nameSubstr) {
        const q = nameSubstr.toLowerCase();
        const piece = all.find(
          (it) => it && it.itemType === ARMOR_ITEM_TYPE && it.displayProperties &&
            it.displayProperties.name && it.displayProperties.name.toLowerCase().includes(q)
        );
        if (!piece) { console.log('No armor piece matched: ' + nameSubstr); return null; }
        const cats = (piece.sockets && piece.sockets.socketCategories) || [];
        const perksCat = cats.find(
          (cat) => socketCategoryNameByHash && (socketCategoryNameByHash.get(cat.socketCategoryHash) || '').toUpperCase().includes('ARMOR PERK')
        );
        if (!perksCat) { console.log('No ARMOR PERKS socket category found on: ' + piece.displayProperties.name); return null; }
        console.log('=== ' + piece.displayProperties.name + ' — ARMOR PERKS sockets ' + JSON.stringify(perksCat.socketIndexes) + ' ===');
        perksCat.socketIndexes.forEach((idx) => {
          const entry = (piece.sockets.socketEntries || [])[idx];
          if (!entry) { console.log('socket ' + idx + ': (missing entry)'); return; }
          const initial = entry.singleInitialItemHash && itemByHash ? itemByHash.get(entry.singleInitialItemHash) : null;
          const plugSetHash = entry.reusablePlugSetHash || entry.randomizedPlugSetHash;
          let plugPoolNames = [];
          if (plugSetHash && plugSetsByHash && plugSetsByHash.has(plugSetHash)) {
            plugPoolNames = plugSetsByHash.get(plugSetHash)
              .map((h) => (itemByHash && itemByHash.get(h) ? itemByHash.get(h).name : '(hash ' + h + ', unresolved)'));
          }
          console.log('socket ' + idx + ':', JSON.stringify({
            singleInitialItemHash: entry.singleInitialItemHash || null,
            singleInitialItemName: initial ? initial.name : null,
            reusablePlugSetHash: entry.reusablePlugSetHash || null,
            randomizedPlugSetHash: entry.randomizedPlugSetHash || null,
            plugPoolNames: plugPoolNames
          }));
        });
        return piece;
      };

      window.debugArmorAllCategories = function (nameSubstr) {
        const q = nameSubstr.toLowerCase();
        const piece = all.find(
          (it) => it && it.itemType === ARMOR_ITEM_TYPE && it.displayProperties &&
            it.displayProperties.name && it.displayProperties.name.toLowerCase().includes(q)
        );
        if (!piece) { console.log('No armor piece matched: ' + nameSubstr); return null; }
        const cats = (piece.sockets && piece.sockets.socketCategories) || [];
        console.log('=== ' + piece.displayProperties.name + ' — ALL socket categories ===');
        cats.forEach((cat) => {
          const catName = (socketCategoryNameByHash && socketCategoryNameByHash.get(cat.socketCategoryHash)) || '(name unresolved)';
          console.log('Category "' + catName + '" (hash ' + cat.socketCategoryHash + '), socket indexes: ' + JSON.stringify(cat.socketIndexes));
          cat.socketIndexes.forEach((idx) => {
            const entry = (piece.sockets.socketEntries || [])[idx];
            if (!entry) return;
            const plugSetHash = entry.reusablePlugSetHash || entry.randomizedPlugSetHash;
            const poolSize = (plugSetHash && plugSetsByHash && plugSetsByHash.get(plugSetHash)) ? plugSetsByHash.get(plugSetHash).length : 0;
            console.log('  socket ' + idx + ': singleInitialItemHash=' + (entry.singleInitialItemHash || 'none') +
              ', reusablePlugSetHash=' + (entry.reusablePlugSetHash || 'none') +
              ', randomizedPlugSetHash=' + (entry.randomizedPlugSetHash || 'none') +
              ', poolSize=' + poolSize);
          });
        });
        return piece;
      };

      window.debugPlugPool = function (plugSetHash) {
        if (!plugSetsByHash || !plugSetsByHash.has(plugSetHash)) {
          console.log('Plug set hash ' + plugSetHash + ' not found (plugSetsByHash not ready yet?).');
          return null;
        }
        const hashes = plugSetsByHash.get(plugSetHash);
        const rows = hashes.map((h) => {
          const it = all.find((i) => i.hash === h);
          if (!it) return { hash: h, found: false };
          return {
            hash: h,
            name: it.displayProperties ? it.displayProperties.name : null,
            hasIcon: !!(it.displayProperties && it.displayProperties.icon),
            plugCategoryIdentifier: it.plug ? it.plug.plugCategoryIdentifier : null,
            perks: it.perks || []
          };
        });
        console.log('=== Plug pool ' + plugSetHash + ' (' + rows.length + ' entries) ===');
        rows.forEach((r) => console.log(JSON.stringify(r)));
        return rows;
      };

      window.debugResolveHashDetailed = function (hash) {
        const item = all.find((i) => i && i.hash === hash);
        if (!item) { console.log('No item found for hash ' + hash + ' in the manifest at all.'); return null; }
        console.log(JSON.stringify({
          hash: item.hash,
          name: item.displayProperties && item.displayProperties.name,
          hasIcon: !!(item.displayProperties && item.displayProperties.icon),
          itemTypeDisplayName: item.itemTypeDisplayName,
          itemType: item.itemType,
          redacted: item.redacted,
          plugCategoryIdentifier: item.plug ? item.plug.plugCategoryIdentifier : null
        }, null, 2));
        return item;
      };
      itemByHash = new Map();
      all.forEach((it) => {
        if (it && !it.redacted && it.displayProperties && it.displayProperties.name && it.displayProperties.icon) {
          itemByHash.set(it.hash, { name: it.displayProperties.name, icon: 'https://www.bungie.net' + it.displayProperties.icon });
        }
      });

      manifestItems = all
        .filter((it) => it && !it.redacted && it.itemType === ARMOR_ITEM_TYPE && it.displayProperties && it.displayProperties.name && it.displayProperties.icon)
        .map((it) => ({
          hash: it.hash,
          name: it.displayProperties.name,
          normName: normalizeText(it.displayProperties.name),
          icon: 'https://www.bungie.net' + it.displayProperties.icon,
          classType: it.classType,
          tierType: it.inventory ? it.inventory.tierType : 0,
          bucketTypeHash: it.inventory ? it.inventory.bucketTypeHash : null,
          // Set-bonus perks (2-piece/4-piece) live in an armor item's own
          // top-level `perks` array as real named DestinySandboxPerkDefinition
          // entries — not something to guess by searching the set's flavor
          // name. Capture it here so findSetBonusPerks() can resolve it later.
          perks: Array.isArray(it.perks)
            ? it.perks.map((p) => ({
                perkHash: p.perkHash,
                requirementDisplayString: p.requirementDisplayString || '',
                perkVisibility: p.perkVisibility != null ? p.perkVisibility : 0
              }))
            : []
        }));
      allNamedItems = all
        .filter((it) => it && !it.redacted && it.displayProperties && it.displayProperties.name && it.displayProperties.icon)
        .map((it) => ({
          hash: it.hash,
          name: it.displayProperties.name,
          normName: normalizeText(it.displayProperties.name),
          icon: 'https://www.bungie.net' + it.displayProperties.icon,
          tierType: it.inventory ? it.inventory.tierType : 0
        }));
      weaponItems = all
        .filter((it) => it && !it.redacted && it.itemType === WEAPON_ITEM_TYPE && it.displayProperties && it.displayProperties.name && it.displayProperties.icon)
        .map((it) => {
          let powerCapHash = null;
          if (it.quality && Array.isArray(it.quality.versions) && it.quality.currentVersion != null) {
            const v = it.quality.versions[it.quality.currentVersion];
            if (v) powerCapHash = v.powerCapHash || null;
          }
          return {
            hash: it.hash,
            name: it.displayProperties.name,
            normName: normalizeText(it.displayProperties.name),
            icon: 'https://www.bungie.net' + it.displayProperties.icon,
            tierType: it.inventory ? it.inventory.tierType : 0,
            socketEntries: it.sockets ? it.sockets.socketEntries : null,
            socketCategories: it.sockets ? it.sockets.socketCategories : null,
            seasonHash: it.seasonHash || null,
            powerCapHash: powerCapHash,
            collectibleHash: it.collectibleHash || null,
            description: it.displayProperties.description || null,
            iconWatermark: it.iconWatermark || null
          };
        });

      setLoadProgress(0.85, 'Downloading weapon perk pools...');
      try {
        const plugSetPath = idxJson.Response.jsonWorldComponentContentPaths.en.DestinyPlugSetDefinition;
        const plugSetJson = await fetchJsonWithProgress(PROXY_BASE + plugSetPath, (frac) => {
          setLoadProgress(0.85 + frac * 0.06, 'Downloading weapon perk pools — ' + Math.round(frac * 100) + '%...');
        });
        plugSetsByHash = new Map();
        Object.values(plugSetJson).forEach((ps) => {
          const items = (ps.reusablePlugItems || []).map((p) => p.plugItemHash);
          plugSetsByHash.set(ps.hash, items);
        });
      } catch (err) {
        console.error('Could not load plug sets — perk columns will fall back to free search.', err);
        plugSetsByHash = new Map();
      }

      setLoadProgress(0.91, 'Downloading socket category info...');
      try {
        const socketCatPath = idxJson.Response.jsonWorldComponentContentPaths.en.DestinySocketCategoryDefinition;
        const socketCatJson = await fetchJsonWithProgress(PROXY_BASE + socketCatPath, (frac) => {
          setLoadProgress(0.91 + frac * 0.03, 'Downloading socket category info — ' + Math.round(frac * 100) + '%...');
        });
        socketCategoryNameByHash = new Map();
        Object.values(socketCatJson).forEach((cat) => {
          if (cat.displayProperties && cat.displayProperties.name) {
            socketCategoryNameByHash.set(cat.hash, cat.displayProperties.name);
          }
        });
      } catch (err) {
        console.error('Could not load socket categories — perk columns will fall back to free search.', err);
        socketCategoryNameByHash = new Map();
      }

      setLoadProgress(0.96, 'Downloading season info...');
      try {
        const seasonPath = idxJson.Response.jsonWorldComponentContentPaths.en.DestinySeasonDefinition;
        const seasonJson = await fetchJsonWithProgress(PROXY_BASE + seasonPath, (frac) => {
          setLoadProgress(0.96 + frac * 0.015, 'Downloading season info — ' + Math.round(frac * 100) + '%...');
        });
        seasonInfoByHash = new Map();
        Object.values(seasonJson).forEach((s) => {
          const num = s.seasonNumber != null ? s.seasonNumber : null;
          const name = s.displayProperties && s.displayProperties.name ? s.displayProperties.name : null;
          seasonInfoByHash.set(s.hash, { number: num, name: name });
        });
      } catch (err) {
        console.error('Could not load season info — search results will not show a season label.', err);
        seasonInfoByHash = new Map();
      }

      setLoadProgress(0.985, 'Downloading power cap info...');
      try {
        const powerCapPath = idxJson.Response.jsonWorldComponentContentPaths.en.DestinyPowerCapDefinition;
        const powerCapJson = await fetchJsonWithProgress(PROXY_BASE + powerCapPath, (frac) => {
          setLoadProgress(0.985 + frac * 0.005, 'Downloading power cap info — ' + Math.round(frac * 100) + '%...');
        });
        powerCapByHash = new Map();
        Object.values(powerCapJson).forEach((pc) => {
          powerCapByHash.set(pc.hash, pc.powerCap);
        });
      } catch (err) {
        console.error('Could not load power cap info.', err);
        powerCapByHash = new Map();
      }

      setLoadProgress(0.99, 'Downloading item source info...');
      try {
        const collectiblePath = idxJson.Response.jsonWorldComponentContentPaths.en.DestinyCollectibleDefinition;
        const collectibleJson = await fetchJsonWithProgress(PROXY_BASE + collectiblePath, (frac) => {
          setLoadProgress(0.99 + frac * 0.004, 'Downloading item source info — ' + Math.round(frac * 100) + '%...');
        });
        collectibleSourceByHash = new Map();
        collectibleParentByHash = new Map();
        Object.values(collectibleJson).forEach((c) => {
          if (c.sourceString) collectibleSourceByHash.set(c.hash, c.sourceString);
          if (Array.isArray(c.parentNodeHashes) && c.parentNodeHashes.length) {
            collectibleParentByHash.set(c.hash, c.parentNodeHashes[0]);
          }
        });
      } catch (err) {
        console.error('Could not load item source info.', err);
        collectibleSourceByHash = new Map();
        collectibleParentByHash = new Map();
      }

      setLoadProgress(0.997, 'Downloading collection grouping info...');
      try {
        const nodePath = idxJson.Response.jsonWorldComponentContentPaths.en.DestinyPresentationNodeDefinition;
        const nodeJson = await fetchJsonWithProgress(PROXY_BASE + nodePath, (frac) => {
          setLoadProgress(0.997 + frac * 0.003, 'Downloading collection grouping info — ' + Math.round(frac * 100) + '%...');
        });
        presentationNodeByHash = new Map();
        Object.values(nodeJson).forEach((n) => {
          presentationNodeByHash.set(n.hash, {
            name: n.displayProperties && n.displayProperties.name ? n.displayProperties.name : null,
            parentHash: Array.isArray(n.parentNodeHashes) && n.parentNodeHashes.length ? n.parentNodeHashes[0] : null,
            index: n.index != null ? n.index : null
          });
        });
      } catch (err) {
        console.error('Could not load collection grouping info — release-order sorting will fall back to name-based order.', err);
        presentationNodeByHash = new Map();
      }

      setLoadProgress(0.999, 'Downloading set bonus perk info...');
      try {
        const perkPath = idxJson.Response.jsonWorldComponentContentPaths.en.DestinySandboxPerkDefinition;
        const perkJson = await fetchJsonWithProgress(PROXY_BASE + perkPath, (frac) => {
          setLoadProgress(0.999 + frac * 0.001, 'Downloading set bonus perk info — ' + Math.round(frac * 100) + '%...');
        });
        sandboxPerkByHash = new Map();
        Object.values(perkJson).forEach((p) => {
          if (p.displayProperties && p.displayProperties.name && p.displayProperties.icon) {
            sandboxPerkByHash.set(p.hash, {
              name: p.displayProperties.name,
              icon: 'https://www.bungie.net' + p.displayProperties.icon
            });
          }
        });
      } catch (err) {
        console.error('Could not load sandbox perk info — set bonus icon auto-fill will be unavailable (manual "?" pick still works).', err);
        sandboxPerkByHash = new Map();
      }

      setLoadSuccess('Ready! Item database loaded (' + manifestItems.length + ' armor pieces).');
      return manifestItems;
    })();
    try {
      const items = await manifestPromise;
      await loadGenericIcons();
      return items;
    }
    catch (err) {
      manifestPromise = null;
      console.error('ensureManifestLoaded failed:', err);
      setLoadError('Could not load the item database — check your connection and API key. (See console for details: ' + (err && err.message ? err.message : err) + ')');
      throw err;
    }
  }

  const genericIcons = { titan: {}, hunter: {}, warlock: {} };
  let genericIconsLoaded = false;

  async function loadGenericIcons() {
    if (genericIconsLoaded) return;
    setLoadProgress(0.99, 'Fetching generic slot icons...');
    for (const cls of CLASSES) {
      for (const slot of SLOTS) {
        const bucket = BUCKET_HASHES[slot];
        const classTypeNum = CLASS_TYPE_ENUM[cls];
        let candidates = manifestItems.filter((i) => i.classType === classTypeNum && i.bucketTypeHash === bucket && i.tierType === 5);
        if (candidates.length === 0) {
          candidates = manifestItems.filter((i) => i.classType === classTypeNum && i.bucketTypeHash === bucket);
        }
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(candidates.length / 2)];
          try {
            genericIcons[cls][slot] = await fetchImageAsBase64(pick.icon, 44);
          } catch (err) { /* leave unset, tile falls back to plain gray */ }
        }
      }
    }
    genericIconsLoaded = true;
    setLoadSuccess('Ready! Generic slot icons loaded — every tile now shows a real Destiny icon by default.');
  }

  // Destiny item names often use a typographic apostrophe (') while typed
  // search queries use a plain one ('). Normalize both so matches aren't
  // silently missed over punctuation differences.
  function normalizeText(s) {
    return s.toLowerCase().replace(/[\u2018\u2019\u02bc`]/g, "'").trim();
  }

  function scoreMatch(item, normQuery) {
    const name = item.normName;
    let score = 0;
    if (name === normQuery) score += 100;
    else if (name.startsWith(normQuery) || name.endsWith(normQuery)) score += 40;
    if (item.tierType === 5) score += 25; // Legendary tier preferred over Exotic/Common/etc.
    score -= Math.abs(name.length - normQuery.length) * 0.4; // prefer names close in length to the query
    return score;
  }

  async function searchBungieItems(query, forClass) {
    await ensureManifestLoaded();
    const q = normalizeText(query.trim());
    const classFilter = CLASS_TYPE_ENUM[forClass || activeClass];
    const matches = manifestItems.filter((i) => i.normName.includes(q) && i.classType === classFilter);
    matches.sort((a, b) => scoreMatch(b, q) - scoreMatch(a, q));
    return matches;
  }

  async function searchAnyItem(query) {
    await ensureManifestLoaded();
    const q = normalizeText(query.trim());
    const matches = allNamedItems.filter((i) => i.normName.includes(q));
    matches.sort((a, b) => scoreMatch(b, q) - scoreMatch(a, q));
    return matches;
  }

  async function searchWeapons(query) {
    await ensureManifestLoaded();
    const q = normalizeText(query.trim());
    const matches = weaponItems.filter((i) => i.normName.includes(q));
    matches.sort((a, b) => scoreMatch(b, q) - scoreMatch(a, q) || a.hash - b.hash);
    return matches.map((w) => ({ ...w, seasonLabel: getVersionLabel(w) }));
  }

  // Prefers a real season name/number when available (season-pass weapons).
  // Falls back to the item's collectible "source string" (Bungie's own
  // where-to-get-this text), which tends to distinguish reissues even when
  // there's no season data. Power cap is checked last since it's often
  // identical across old/reissued copies once Bungie unifies caps over time.
  function getVersionLabel(weapon) {
    if (weapon.seasonHash && seasonInfoByHash) {
      const info = seasonInfoByHash.get(weapon.seasonHash);
      if (info) {
        if (info.number != null && info.name) return 'Season ' + info.number + ' — ' + info.name;
        if (info.number != null) return 'Season ' + info.number;
        if (info.name) return info.name;
      }
    }
    if (weapon.collectibleHash && collectibleSourceByHash) {
      const source = collectibleSourceByHash.get(weapon.collectibleHash);
      if (source) return source;
    }
    if (weapon.powerCapHash && powerCapByHash) {
      const cap = powerCapByHash.get(weapon.powerCapHash);
      if (cap != null && cap < 900000) return 'Power cap ' + cap; // Bungie uses a huge sentinel value for "uncapped"
    }
    return null;
  }

  function resolveSocketCandidates(entry) {
    if (!entry) return [];
    const plugSetHash = entry.randomizedPlugSetHash || entry.reusablePlugSetHash;
    let hashes = [];
    if (plugSetHash && plugSetsByHash) hashes = plugSetsByHash.get(plugSetHash) || [];
    // Masterwork (and some other fixed ladders) list options directly on the
    // socket entry rather than through a shared plug set.
    if (hashes.length === 0 && Array.isArray(entry.reusablePlugItems)) {
      hashes = entry.reusablePlugItems.map((p) => p.plugItemHash);
    }
    const candidates = hashes
      .map((h) => {
        const info = itemByHash && itemByHash.get(h);
        return info ? { hash: h, name: info.name, icon: info.icon } : null;
      })
      .filter(Boolean);

    // Enhanced perks share the same display name as their base version — only
    // keep one of each name since we just need an icon + name for reference.
    const seenNames = new Set();
    const deduped = [];
    candidates.forEach((c) => {
      if (!seenNames.has(c.name)) {
        seenNames.add(c.name);
        deduped.push(c);
      }
    });
    return deduped;
  }

  // Classifies a weapon's sockets by their actual category name (from
  // DestinySocketCategoryDefinition) rather than guessing by position, so it
  // stays correct even if a weapon has an unusual socket layout.
  // Returns up to 4 real roll columns (barrel/scope, mag, perk 1, perk 2).
  function getWeaponPerkColumns(weaponHash) {
    let perkColumns = [];
    if (!weaponItems) return perkColumns;
    const weapon = weaponItems.find((w) => w.hash === weaponHash);
    if (!weapon || !weapon.socketEntries || !weapon.socketCategories) return perkColumns;

    const seenIndexes = new Set(); // some weapons list the same socket under more than one category

    weapon.socketCategories.forEach((cat) => {
      const catName = (socketCategoryNameByHash && socketCategoryNameByHash.get(cat.socketCategoryHash)) || '';
      const lname = catName.toLowerCase();
      const indexes = cat.socketIndexes || [];

      if (lname.includes('perk')) {
        indexes.forEach((idx) => {
          if (seenIndexes.has(idx)) return;
          seenIndexes.add(idx);
          const candidates = resolveSocketCandidates(weapon.socketEntries[idx]);
          if (candidates.length > 1) perkColumns.push(candidates);
        });
      }
    });

    // If two columns ended up with the exact same set of options (can happen
    // when a weapon's data lists an equivalent socket more than once), only
    // keep one of them.
    const seenSignatures = new Set();
    const deduped = [];
    perkColumns.forEach((col) => {
      const sig = col.map((c) => c.name).sort().join('|');
      if (!seenSignatures.has(sig)) {
        seenSignatures.add(sig);
        deduped.push(col);
      }
    });

    return deduped.slice(0, 4);
  }

  async function fetchImageAsBase64(url, size) {
    const targetSize = size || 40;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Image fetch failed: ' + res.status);
    const blob = await res.blob();
    try {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = targetSize; canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, targetSize, targetSize);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (err) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  }

  // --- Rendering ---
  const app = document.getElementById('app');
  const emptyState = document.getElementById('empty-state');
  const progressText = document.getElementById('progressText');
  const confirmContainer = document.getElementById('confirm-container');

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Weapon wishlist ---
  const wishlistList = document.getElementById('wishlist-list');
  const wishlistEmpty = document.getElementById('wishlist-empty');
  const wishlistNameInput = document.getElementById('wishlist-name-input');
  const wishlistAddIcon = document.getElementById('wishlist-add-icon');
  const wishlistAddStatus = document.getElementById('wishlist-add-status');

  function migrateWishlistEntry(entry) {
    if (!Array.isArray(entry.perks)) {
      entry.perks = [entry.perk1 || null, entry.perk2 || null, null, null];
      delete entry.perk1;
      delete entry.perk2;
    }
    while (entry.perks.length < 4) entry.perks.push(null);
    delete entry.masterwork;
    delete entry.originTraits;
    return entry;
  }

  function renderWishlist() {
    wishlistList.innerHTML = '';
    wishlist.forEach(migrateWishlistEntry);
    wishlistEmpty.style.display = wishlist.length ? 'none' : 'block';

    wishlist.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'wishlist-row';

      const iconEl = document.createElement('div');
      iconEl.className = 'wishlist-perk-slot' + (entry.icon ? ' filled' : '');
      iconEl.style.width = '44px';
      iconEl.style.height = '44px';
      if (entry.icon) iconEl.style.backgroundImage = 'url(' + entry.icon + ')';
      else iconEl.textContent = '?';
      iconEl.title = 'Click to change this weapon';
      iconEl.addEventListener('click', () => openWeaponReplaceModal(entry));
      row.appendChild(iconEl);

      const nameEl = document.createElement('div');
      nameEl.className = 'wishlist-name';
      nameEl.textContent = entry.name;
      row.appendChild(nameEl);

      const perkColumns = entry.weaponHash != null ? getWeaponPerkColumns(entry.weaponHash) : [];

      const perksEl = document.createElement('div');
      perksEl.className = 'wishlist-perks';
      for (let i = 0; i < 4; i++) {
        const col = perkColumns[i] || null;
        const slot = document.createElement('div');
        const filled = entry.perks[i];
        slot.className = 'wishlist-perk-slot' + (filled ? ' filled' : '');
        if (filled) slot.style.backgroundImage = 'url(' + filled + ')';
        else slot.textContent = 'Perk ' + (i + 1);
        slot.title = col ? 'Click to pick from this weapon\'s real perk pool (perk ' + (i + 1) + ')' : 'Click to search for this perk';
        slot.addEventListener('click', () => openWeaponPerkModal(entry, i, col));
        perksEl.appendChild(slot);
      }
      row.appendChild(perksEl);

      const delBtn = document.createElement('button');
      delBtn.className = 'wishlist-delete-btn';
      delBtn.textContent = '✕';
      delBtn.title = 'Remove from wishlist';
      delBtn.addEventListener('click', () => {
        wishlist = wishlist.filter((w) => w.id !== entry.id);
        saveData();
        renderWishlist();
      });
      row.appendChild(delBtn);

      wishlistList.appendChild(row);
    });
  }

  function openWeaponPerkModal(entry, perkIndex, fixedColumn) {
    const subtitle = entry.name + ' — perk ' + (perkIndex + 1) + (fixedColumn && fixedColumn.length ? ' (real options)' : ' (free search)');
    const onSelect = (dataUrl) => {
      entry.perks[perkIndex] = dataUrl;
      saveData();
      renderWishlist();
    };
    if (fixedColumn && fixedColumn.length) {
      openGenericModal(subtitle, '', null, onSelect, fixedColumn);
    } else {
      openGenericModal(subtitle, entry.name, (query) => searchAnyItem(query), onSelect);
    }
  }

  function openBonusIconModal(set, iconKey, label) {
    const setShortName = set.name.split('—').pop().trim();
    openGenericModal(
      set.name + ' — ' + label + ' bonus',
      setShortName,
      (query) => searchAnyItem(query),
      (dataUrl) => {
        if (!bonusIcons[set.name]) bonusIcons[set.name] = {};
        bonusIcons[set.name][iconKey] = dataUrl;
        saveData();
        render();
      }
    );
  }

  // Resolves the real 2-piece/4-piece set bonus perks for a set by reading
  // the `perks` array straight off one of its own armor pieces (a DIM
  // screenshot confirmed these are real named DestinySandboxPerkDefinition
  // entries, e.g. "Rapid Repair" / "Built from Scratch" — not something
  // discoverable by searching the set's flavor name, which only turns up
  // armor pieces themselves). Returns { icon2, icon4 } (each { name, icon }
  // or null) or null if no piece/perks could be resolved.
  function findSetBonusPerks(set) {
    if (!manifestItems || !sandboxPerkByHash) return null;
    const setShortName = set.name.split('—').pop().trim();
    const q = normalizeText(setShortName);
    const candidates = manifestItems.filter(
      (i) => i.tierType === 5 && Array.isArray(i.perks) && i.perks.length && i.normName.includes(q)
    );
    if (!candidates.length) return null;

    for (const piece of candidates) {
      const visible = piece.perks.filter((p) => p.perkVisibility === 0 && sandboxPerkByHash.has(p.perkHash));
      if (visible.length < 2) continue;

      // Default to the last two visible perks (set bonuses are appended at
      // the end of the array, after any other intrinsic/trait perks).
      let perk2 = visible[visible.length - 2];
      let perk4 = visible[visible.length - 1];

      // Where Bungie's requirementDisplayString spells out "2 equipped" /
      // "4 equipped" explicitly, trust that over array position.
      visible.forEach((p) => {
        const txt = p.requirementDisplayString.toLowerCase();
        if (txt.includes('2 equipped') || txt.includes('2 items') || txt.includes('2-piece') || txt.includes('2 piece')) perk2 = p;
        if (txt.includes('4 equipped') || txt.includes('4 items') || txt.includes('4-piece') || txt.includes('4 piece')) perk4 = p;
      });

      return {
        icon2: sandboxPerkByHash.get(perk2.perkHash) || null,
        icon4: sandboxPerkByHash.get(perk4.perkHash) || null
      };
    }
    return null;
  }

  async function autoFillBonusIconsForSet(set) {
    const found = findSetBonusPerks(set);
    if (!found) return false;
    if (!bonusIcons[set.name]) bonusIcons[set.name] = {};
    let changed = false;
    if (found.icon2 && !bonusIcons[set.name].icon2) {
      bonusIcons[set.name].icon2 = await fetchImageAsBase64(found.icon2.icon, 40);
      changed = true;
    }
    if (found.icon4 && !bonusIcons[set.name].icon4) {
      bonusIcons[set.name].icon4 = await fetchImageAsBase64(found.icon4.icon, 40);
      changed = true;
    }
    return changed;
  }

  async function autoFillAllBonusIcons(buttonEl) {
    const originalLabel = buttonEl.textContent;
    buttonEl.disabled = true;
    try {
      await ensureManifestLoaded();
    } catch (err) {
      alert('Could not load the item database. Check your connection and try again.');
      buttonEl.disabled = false;
      buttonEl.textContent = originalLabel;
      return;
    }
    if (!sandboxPerkByHash || sandboxPerkByHash.size === 0) {
      alert('Set bonus perk data could not be loaded — check your connection and try "Reload generic icons", then retry.');
      buttonEl.disabled = false;
      buttonEl.textContent = originalLabel;
      return;
    }

    const allSets = [];
    data.forEach((cat) => cat.sets.forEach((s) => allSets.push(s)));
    let done = 0, filled = 0, missed = [];

    for (const set of allSets) {
      done++;
      buttonEl.textContent = 'Filling ' + done + '/' + allSets.length + '...';
      const already = bonusIcons[set.name] || {};
      if (already.icon2 && already.icon4) { filled++; continue; }
      try {
        const found = await autoFillBonusIconsForSet(set);
        const now = bonusIcons[set.name] || {};
        if (now.icon2 && now.icon4) filled++;
        else missed.push(set.name);
      } catch (err) {
        missed.push(set.name);
      }
      if (done % 10 === 0) saveData();
    }

    const ok = saveData();
    buttonEl.disabled = false;
    buttonEl.textContent = originalLabel;
    render();
    let msg = 'Auto-filled bonus icons for ' + filled + ' of ' + allSets.length + ' sets.';
    if (missed.length) msg += '\n\nCould not auto-resolve (use the 2p/4p "?" icons to pick manually):\n- ' + missed.join('\n- ');
    alert(msg);
    if (!ok) alert('Local storage may be full — some results might not have been saved.');
  }

  function openWeaponReplaceModal(entry) {
    openGenericModal(
      'Change weapon (real Destiny weapons only)',
      entry.name,
      (query) => searchWeapons(query),
      (dataUrl, itemName, hash) => {
        entry.name = itemName;
        entry.icon = dataUrl;
        entry.weaponHash = hash;
        entry.perks = [null, null, null, null];
        saveData();
        renderWishlist();
      }
    );
  }

  async function runAddWeaponSearch() {
    const query = wishlistNameInput.value.trim();
    if (!query) return;
    wishlistAddStatus.textContent = 'Searching...';
    try {
      const results = await searchWeapons(query);
      if (results.length === 0) {
        wishlistAddStatus.textContent = 'No matching weapon found in the game — check spelling or try fewer words.';
        return;
      }
      // Open the shared modal so the person can confirm the exact match
      // (many weapons share similar names across reissues/seasons).
      openGenericModal(
        'Pick the exact weapon',
        query,
        (q) => searchWeapons(q),
        async (dataUrl, itemName, hash) => {
          wishlist.push({
            id: 'w' + Date.now() + Math.random().toString(36).slice(2),
            name: itemName,
            icon: dataUrl,
            weaponHash: hash,
            perks: [null, null, null, null]
          });
          wishlistNameInput.value = '';
          wishlistAddStatus.textContent = '';
          saveData();
          renderWishlist();
        }
      );
    } catch (err) {
      wishlistAddStatus.textContent = 'Error reaching Bungie API. Check your API key and connection.';
    }
  }

  document.getElementById('wishlist-add-btn').addEventListener('click', runAddWeaponSearch);
  wishlistNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runAddWeaponSearch(); });

  function computeOverallProgress() {
    let owned = 0, total = 0;
    data.forEach((cat) => cat.sets.forEach((s) => s.pieces.forEach((p) => { total++; if (p.owned[activeClass]) owned++; })));
    return { owned, total };
  }

  function render() {
    app.innerHTML = '';
    if (currentView === 'armor') {
      document.querySelectorAll('.class-tab-btn[data-class]').forEach((t) => t.classList.toggle('active', t.getAttribute('data-class') === activeClass));
    }

    const { owned, total } = computeOverallProgress();
    progressText.textContent = owned + ' / ' + total + ' collected (' + CLASS_LABEL[activeClass] + ')';

    data.forEach((cat) => {
      const catOwned = cat.sets.reduce((sum, s) => sum + s.pieces.filter((p) => p.owned[activeClass]).length, 0);
      const catTotal = cat.sets.reduce((sum, s) => sum + s.pieces.length, 0);
      const h2 = document.createElement('h2');
      h2.className = 'header';
      h2.innerHTML = escapeHtml(cat.category) + '<span class="cat-count">' + catOwned + ' / ' + catTotal + '</span>';
      app.appendChild(h2);

      cat.sets.forEach((set) => {
        const bonus = SET_BONUSES[set.name];
        const tooltipHtml = bonus
          ? '<span class="tag">2-PIECE</span>' + escapeHtml(bonus[0]) + '<br/><br/><span class="tag">4-PIECE</span>' + escapeHtml(bonus[1])
          : 'No bonus data available.';
        const setOwned = set.pieces.filter((p) => p.owned[activeClass]).length;

        const row = document.createElement('div');
        row.className = 'set-row';
        row.setAttribute('data-searchtext', set.name.toLowerCase());

        const infoDiv = document.createElement('div');
        infoDiv.className = 'set-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'set-name-row';
        const nameStrong = document.createElement('strong');
        nameStrong.textContent = set.name;
        nameRow.appendChild(nameStrong);

        const bonusWrap = document.createElement('span');
        bonusWrap.className = 'bonus-icons-wrap';
        const tooltipDiv = document.createElement('div');
        tooltipDiv.className = 'tooltip';
        tooltipDiv.innerHTML = tooltipHtml;
        const setBonusIcons = bonusIcons[set.name] || {};
        ['icon2', 'icon4'].forEach((key, idx) => {
          const slot = document.createElement('div');
          const filled = setBonusIcons[key];
          slot.className = 'bonus-icon-slot' + (filled ? ' filled' : '');
          if (filled) slot.style.backgroundImage = 'url(' + filled + ')';
          else slot.textContent = idx === 0 ? '2p' : '4p';
          slot.title = (idx === 0 ? '2-piece' : '4-piece') + ' bonus — click to find its icon';
          slot.addEventListener('click', (e) => {
            e.stopPropagation();
            openBonusIconModal(set, key, idx === 0 ? '2-piece' : '4-piece');
          });
          bonusWrap.appendChild(slot);
        });
        bonusWrap.appendChild(tooltipDiv);
        nameRow.appendChild(bonusWrap);
        infoDiv.appendChild(nameRow);

        const countTag = document.createElement('div');
        countTag.className = 'set-count-tag';
        countTag.textContent = setOwned + ' / ' + set.pieces.length + ' (' + CLASS_LABEL[activeClass] + ')';
        infoDiv.appendChild(countTag);
        row.appendChild(infoDiv);

        const columnsDiv = document.createElement('div');
        columnsDiv.className = 'class-columns';
        const col = document.createElement('div');
        col.className = 'class-col';
        col.setAttribute('data-class', activeClass);
        const slotsRow = document.createElement('div');
        slotsRow.className = 'slots-row';

        set.pieces.forEach((piece) => {
          if (!piece.icons) piece.icons = {};
          const isOwned = !!piece.owned[activeClass];
          const icon = piece.icons[activeClass] || (genericIcons[activeClass] && genericIcons[activeClass][piece.slot]);
          const slot = document.createElement('div');
          slot.className = 'slot-icon' + (isOwned ? ' active' : '');
          slot.title = CLASS_LABEL[activeClass] + ' — ' + set.name + ' — ' + piece.slot;
          if (icon) slot.style.backgroundImage = 'url(' + icon + ')';

          const findBtn = document.createElement('div');
          findBtn.className = 'slot-find-btn';
          findBtn.textContent = '?';
          findBtn.title = 'Find icon';
          findBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openIconModal(set, piece, activeClass);
          });
          slot.appendChild(findBtn);

          slot.addEventListener('click', () => {
            piece.owned[activeClass] = !piece.owned[activeClass];
            saveData();
            render();
          });

          slotsRow.appendChild(slot);
        });

        col.appendChild(slotsRow);
        columnsDiv.appendChild(col);
        row.appendChild(columnsDiv);
        app.appendChild(row);
      });
    });

    filterSets();
  }

  window.filterSets = function () {
    const term = document.getElementById('searchBar').value.toLowerCase();
    let anyVisible = false;
    document.querySelectorAll('.set-row').forEach((row) => {
      const match = !term || row.getAttribute('data-searchtext').includes(term);
      row.style.display = match ? 'flex' : 'none';
      if (match) anyVisible = true;
    });
    emptyState.style.display = anyVisible ? 'none' : 'block';
  };

  // Replaces the old inline onkeyup="filterSets()" handler (blocked by CSP).
  document.getElementById('searchBar').addEventListener('keyup', window.filterSets);

  // --- Icon search modal (generic: used for armor pieces and weapon wishlist perks) ---
  const modalOverlay = document.getElementById('icon-modal');
  const modalSubtitle = document.getElementById('modal-subtitle');
  const modalSearchInput = document.getElementById('modal-search-input');
  const modalSearchBtn = document.getElementById('modal-search-btn');
  const modalStatus = document.getElementById('modal-status');
  const modalResults = document.getElementById('modal-results');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');

  let modalSearchFn = null;
  let modalOnSelect = null;
  let modalFixedResults = null;

  function openGenericModal(subtitleText, initialQuery, searchFn, onSelect, fixedResults) {
    modalSearchFn = searchFn;
    modalOnSelect = onSelect;
    modalFixedResults = fixedResults || null;
    modalSubtitle.textContent = subtitleText;
    modalSearchInput.value = initialQuery;
    modalSearchInput.placeholder = fixedResults ? 'Filter this weapon\'s real options...' : 'Search item name...';
    modalResults.innerHTML = '';
    modalStatus.textContent = '';
    modalOverlay.classList.add('open');
    runModalSearch();
  }

  function openIconModal(set, piece, cls) {
    const setShortName = set.name.split('—').pop().trim();
    const specificSlotName = (CLASS_SLOT_NAME[cls] && CLASS_SLOT_NAME[cls][piece.slot]) || piece.slot;
    openGenericModal(
      CLASS_LABEL[cls] + ' — ' + set.name + ' — ' + piece.slot,
      setShortName + ' ' + specificSlotName,
      (query) => searchBungieItems(query, cls),
      (dataUrl) => {
        if (!piece.icons) piece.icons = {};
        piece.icons[cls] = dataUrl;
        saveData();
        render();
      }
    );
  }

  function closeIconModal() {
    modalOverlay.classList.remove('open');
    modalSearchFn = null;
    modalOnSelect = null;
    modalFixedResults = null;
  }

  async function runModalSearch() {
    const query = modalSearchInput.value.trim();
    modalResults.innerHTML = '';

    let results;
    if (modalFixedResults) {
      // Filter the weapon's real, fixed perk pool locally — no network call.
      const q = normalizeText(query);
      results = q ? modalFixedResults.filter((r) => normalizeText(r.name).includes(q)) : modalFixedResults;
      modalStatus.textContent = results.length ? results.length + ' possible option(s) for this weapon' : 'No match in this weapon\'s real perk pool.';
    } else {
      if (!query || !modalSearchFn) return;
      modalStatus.textContent = 'Searching...';
      try {
        results = await modalSearchFn(query);
        modalStatus.textContent = results.length ? results.length + ' results' : 'No results. Try a different search term.';
      } catch (err) {
        modalStatus.textContent = 'Error reaching Bungie API. Check your API key and connection.';
        console.error(err);
        return;
      }
    }

    results.slice(0, 30).forEach((r) => {
      const row = document.createElement('div');
      row.className = 'modal-result-item';
      // Built with DOM APIs (no innerHTML / inline handlers) so the CSP can stay strict.
      const hideOnError = (el) => { el.addEventListener('error', () => { el.style.display = 'none'; }); };
      const iconWrap = document.createElement('span');
      iconWrap.className = 'icon-wrap';
      const iconImg = document.createElement('img');
      iconImg.alt = '';
      iconImg.src = r.icon;
      hideOnError(iconImg);
      iconWrap.appendChild(iconImg);
      if (r.iconWatermark) {
        const wm = document.createElement('img');
        wm.className = 'watermark-thumb';
        wm.src = 'https://www.bungie.net' + r.iconWatermark;
        wm.alt = '';
        wm.title = 'Version watermark';
        hideOnError(wm);
        iconWrap.appendChild(wm);
      }
      const nameCol = document.createElement('span');
      nameCol.className = 'name-col';
      const nameEl = document.createElement('span');
      nameEl.className = 'name';
      nameEl.textContent = r.name;
      nameCol.appendChild(nameEl);
      if (r.seasonLabel) {
        const season = document.createElement('span');
        season.className = 'season-label';
        season.textContent = r.seasonLabel;
        nameCol.appendChild(season);
      }
      row.appendChild(iconWrap);
      row.appendChild(nameCol);
      row.addEventListener('click', async () => {
        if (!modalOnSelect) { closeIconModal(); return; }
        modalStatus.textContent = 'Downloading image...';
        try {
          const dataUrl = await fetchImageAsBase64(r.icon, 40);
          modalOnSelect(dataUrl, r.name, r.hash);
        } catch (err) {
          modalStatus.textContent = 'Could not download that image. Try another result.';
          return;
        }
        closeIconModal();
      });
      modalResults.appendChild(row);
    });
  }
  modalSearchBtn.addEventListener('click', runModalSearch);
  modalSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runModalSearch(); });
  modalCancelBtn.addEventListener('click', closeIconModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeIconModal(); });

  // --- Auto-fill ---
  const missReportEl = document.getElementById('miss-report');
  let currentMissEntries = [];

  function showMissReport(entries) {
    currentMissEntries = entries;
    if (!entries.length) { missReportEl.style.display = 'none'; return; }
    missReportEl.style.display = 'block';
    missReportEl.innerHTML =
      '<div class="miss-report-title"><span>' + entries.length + ' piece(s) need manual review</span>' +
      '<div><button class="pill" id="miss-report-retry" style="margin-right:8px;">Retry these ' + entries.length + '</button>' +
      '<button class="miss-report-close" id="miss-report-close">✕</button></div></div>' +
      '<div class="miss-report-list" id="miss-report-list"></div>';
    const list = missReportEl.querySelector('#miss-report-list');
    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'miss-report-item';
      row.textContent = CLASS_LABEL[entry.cls] + ' — ' + entry.setName + ' — ' + entry.slot;
      row.addEventListener('click', () => {
        activeClass = entry.cls;
        render();
        openIconModal(entry.set, entry.piece, entry.cls);
      });
      list.appendChild(row);
    });
    document.getElementById('miss-report-close').addEventListener('click', () => { missReportEl.style.display = 'none'; });
    document.getElementById('miss-report-retry').addEventListener('click', (e) => retryMissedEntries(entries, e.target));
  }

  async function retryMissedEntries(entries, buttonEl) {
    const originalLabel = buttonEl.textContent;
    buttonEl.disabled = true;
    const stillMissing = [];
    let recovered = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      buttonEl.textContent = 'Retrying ' + (i + 1) + '/' + entries.length + '...';

      const setShortName = entry.setName.split('—').pop().trim();
      const noPossessive = setShortName.replace(/'s\b/gi, '').replace(/['\u2019]s\b/gi, '');
      const firstWord = setShortName.split(' ')[0];
      const specificSlotName = (CLASS_SLOT_NAME[entry.cls] && CLASS_SLOT_NAME[entry.cls][entry.slot]) || entry.slot;

      // Broader attempts than the original pass: strip possessives, try just
      // the first significant word, and try the plain slot word alone.
      const attempts = [
        noPossessive + ' ' + specificSlotName,
        firstWord + ' ' + specificSlotName,
        noPossessive,
        firstWord,
        setShortName + ' ' + entry.slot.replace('Class item', 'Bond').replace('Chest armor', 'Chest').replace('Leg armor', 'Leg')
      ];

      let found = null;
      for (const query of attempts) {
        if (!query.trim()) continue;
        try {
          const results = await searchBungieItems(query, entry.cls);
          if (results.length > 0) { found = results[0]; break; }
        } catch (err) { /* try next */ }
      }

      if (found) {
        try {
          const dataUrl = await fetchImageAsBase64(found.icon, 40);
          if (!entry.piece.icons) entry.piece.icons = {};
          entry.piece.icons[entry.cls] = dataUrl;
          recovered++;
        } catch (err) { stillMissing.push(entry); }
      } else {
        stillMissing.push(entry);
      }
    }

    saveData();
    render();
    showMissReport(stillMissing);
    buttonEl.disabled = false;
    buttonEl.textContent = originalLabel;
    alert('Retry complete: ' + recovered + ' of ' + entries.length + ' recovered. ' + stillMissing.length + ' still need a manual pick.');
  }

  async function autoFillSet(set, buttonEl) {
    const originalLabel = buttonEl.textContent;
    let successCount = 0;
    const missEntries = [];
    const usedIcons = new Set();

    for (let i = 0; i < set.pieces.length; i++) {
      const piece = set.pieces[i];
      buttonEl.textContent = 'Fetching ' + (i + 1) + '/' + set.pieces.length + '...';
      buttonEl.disabled = true;

      const setShortName = set.name.split('—').pop().trim();
      const specificSlotName = (CLASS_SLOT_NAME[activeClass] && CLASS_SLOT_NAME[activeClass][piece.slot]) || piece.slot;
      const attempts = [setShortName + ' ' + specificSlotName, setShortName + ' ' + piece.slot, setShortName];

      let found = null;
      for (const query of attempts) {
        try {
          const results = await searchBungieItems(query, activeClass);
          const candidate = results.find((r) => !usedIcons.has(r.icon));
          if (candidate) { found = candidate; break; }
        } catch (err) { /* try next */ }
      }

      if (found) {
        try {
          const dataUrl = await fetchImageAsBase64(found.icon, 40);
          if (!piece.icons) piece.icons = {};
          piece.icons[activeClass] = dataUrl;
          usedIcons.add(found.icon);
          successCount++;
        } catch (err) { missEntries.push({ set: set, piece: piece, cls: activeClass, setName: set.name, slot: piece.slot }); }
      } else {
        missEntries.push({ set: set, piece: piece, cls: activeClass, setName: set.name, slot: piece.slot });
      }
    }

    const ok = saveData();
    buttonEl.disabled = false;
    buttonEl.textContent = originalLabel;
    render();
    showMissReport(missEntries);
    if (!ok) alert('Local storage is full — some downloads may not have been saved.');
  }

  async function autoFillEverything(buttonEl) {
    const originalLabel = buttonEl.textContent;
    buttonEl.disabled = true;
    document.getElementById('reset-btn').disabled = true;
    const savedActiveClass = activeClass;

    let totalPieces = 0;
    data.forEach((cat) => cat.sets.forEach((s) => (totalPieces += s.pieces.length * CLASSES.length)));
    let done = 0, filled = 0;
    const missEntries = [];

    try { await ensureManifestLoaded(); }
    catch (err) {
      alert('Could not load the item database. Check your connection and try again.');
      buttonEl.disabled = false;
      document.getElementById('reset-btn').disabled = false;
      buttonEl.textContent = originalLabel;
      return;
    }

    for (const cls of CLASSES) {
      for (const cat of data) {
        for (const set of cat.sets) {
          const setShortName = set.name.split('—').pop().trim();
          const usedIcons = new Set();
          for (const piece of set.pieces) {
            done++;
            buttonEl.textContent = 'Filling ' + done + '/' + totalPieces + '...';
            if (piece.icons && piece.icons[cls]) { filled++; continue; }

            const specificSlotName = (CLASS_SLOT_NAME[cls] && CLASS_SLOT_NAME[cls][piece.slot]) || piece.slot;
            const attempts = [setShortName + ' ' + specificSlotName, setShortName + ' ' + piece.slot, setShortName];
            let found = null;
            for (const query of attempts) {
              try {
                const results = await searchBungieItems(query, cls);
                const candidate = results.find((r) => !usedIcons.has(r.icon));
                if (candidate) { found = candidate; break; }
              } catch (err) { /* try next */ }
            }
            if (found) {
              try {
                const dataUrl = await fetchImageAsBase64(found.icon, 40);
                if (!piece.icons) piece.icons = {};
                piece.icons[cls] = dataUrl;
                usedIcons.add(found.icon);
                filled++;
              } catch (err) { missEntries.push({ set: set, piece: piece, cls: cls, setName: set.name, slot: piece.slot }); }
            } else {
              missEntries.push({ set: set, piece: piece, cls: cls, setName: set.name, slot: piece.slot });
            }

            if (done % 25 === 0) saveData();
          }
        }
      }
    }

    activeClass = savedActiveClass;
    const ok = saveData();
    buttonEl.disabled = false;
    document.getElementById('reset-btn').disabled = false;
    buttonEl.textContent = originalLabel;
    render();
    showMissReport(missEntries);
    if (!ok) alert('Local storage may be full — some results might not have been saved.');
  }

  document.getElementById('reload-icons-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Reloading...';
    genericIconsLoaded = false;
    try {
      await ensureManifestLoaded();
    } catch (err) { /* status already shown in banner */ }
    btn.disabled = false;
    btn.textContent = original;
    render();
  });

  document.getElementById('autofill-bonus-icons-btn').addEventListener('click', (e) => {
    autoFillAllBonusIcons(e.target);
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    confirmContainer.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'confirm-box';
    box.innerHTML = '<span>Uncheck every piece for ' + CLASS_LABEL[activeClass] + ' only? Other classes are unaffected.</span>';
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    const yesBtn = document.createElement('button');
    yesBtn.className = 'pill';
    yesBtn.textContent = 'Yes, reset';
    yesBtn.addEventListener('click', () => {
      data.forEach((cat) => cat.sets.forEach((s) => s.pieces.forEach((p) => (p.owned[activeClass] = false))));
      saveData(); render(); confirmContainer.innerHTML = '';
    });
    const noBtn = document.createElement('button');
    noBtn.className = 'pill';
    noBtn.textContent = 'Cancel';
    noBtn.addEventListener('click', () => { confirmContainer.innerHTML = ''; });
    btnRow.appendChild(yesBtn); btnRow.appendChild(noBtn);
    box.appendChild(btnRow);
    confirmContainer.appendChild(box);
  });

  const armorViewEl = document.getElementById('armor-view');
  const wishlistViewEl = document.getElementById('wishlist-view');
  const searchBarEl = document.getElementById('searchBar');
  const guidesViewEl = document.getElementById('guides-view');
  const guidesBtnEl = document.getElementById('guides-view-btn');
  let currentView = 'armor';

  function showArmorView() {
    currentView = 'armor';
    armorViewEl.style.display = '';
    wishlistViewEl.style.display = 'none';
    guidesViewEl.style.display = 'none';
    searchBarEl.style.display = '';
    document.getElementById('wishlist-view-btn').classList.remove('active');
    guidesBtnEl.classList.remove('active');
  }

  function showWishlistView() {
    currentView = 'wishlist';
    armorViewEl.style.display = 'none';
    wishlistViewEl.style.display = 'block';
    guidesViewEl.style.display = 'none';
    searchBarEl.style.display = 'none';
    document.querySelectorAll('.class-tab-btn[data-class]').forEach((t) => t.classList.remove('active'));
    document.getElementById('wishlist-view-btn').classList.add('active');
    guidesBtnEl.classList.remove('active');
  }

  function showGuidesView() {
    currentView = 'guides';
    armorViewEl.style.display = 'none';
    wishlistViewEl.style.display = 'none';
    guidesViewEl.style.display = 'block';
    searchBarEl.style.display = 'none';
    document.querySelectorAll('.class-tab-btn[data-class]').forEach((t) => t.classList.remove('active'));
    document.getElementById('wishlist-view-btn').classList.remove('active');
    guidesBtnEl.classList.add('active');
    if (window.TGSGuides) window.TGSGuides.show();
  }

  document.querySelectorAll('.class-tab-btn[data-class]').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeClass = tab.getAttribute('data-class');
      showArmorView();
      render();
    });
  });

  document.getElementById('wishlist-view-btn').addEventListener('click', () => {
    showWishlistView();
  });

  guidesBtnEl.addEventListener('click', showGuidesView);

  document.getElementById('copy-sync-code-btn').addEventListener('click', () => {
    const pairing = getOrCreateSyncCode() + ':' + getOrCreateSyncSecret();
    navigator.clipboard.writeText(pairing).then(() => setSyncStatus('Codice completo copiato ✓', false)).catch(() => {});
  });

  document.getElementById('rotate-sync-code-btn').addEventListener('click', rotateSyncCode);

  document.getElementById('load-sync-code-btn').addEventListener('click', async () => {
    const input = document.getElementById('load-sync-code-input');
    const pair = parsePairing(input.value);
    if (!pair) {
      setSyncStatus('Incolla il codice completo (codice:chiave)', true);
      return;
    }
    setSyncStatus('Loading...', false);
    const cloud = await pullFromCloud(pair.code, pair.secret);
    if (cloud && cloud.error) {
      setSyncStatus(syncErrorMessage(cloud.error), true);
      return;
    }
    if (!cloud) {
      setSyncStatus('No data found for that code', true);
      return;
    }
    data = cloud.armorData;
    wishlist = cloud.wishlistData;
    bonusIcons = cloud.bonusIconsData;
    localStorage.setItem(SYNC_CODE_KEY, pair.code);
    localStorage.setItem(SYNC_SECRET_KEY, pair.secret);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(wishlist));
    localStorage.setItem(BONUS_ICONS_STORAGE_KEY, JSON.stringify(bonusIcons));
    input.value = '';
    renderSyncCodeDisplay();
    render();
    renderWishlist();
    setSyncStatus('Loaded ✓', false);
  });

  async function init() {
    loadData();
    renderSyncCodeDisplay();
    render();
    renderWishlist();

    // Chiave appena creata (primo avvio o upgrade): il POST la registra come
    // proprietaria dei record legacy, che fino a quel momento erano senza chiave.
    const hadSecret = localStorage.getItem(SYNC_SECRET_KEY) !== null;
    const code = getOrCreateSyncCode();
    const cloud = await pullFromCloud(code, getOrCreateSyncSecret());
    if (cloud && cloud.error) {
      setSyncStatus(syncErrorMessage(cloud.error), true);
    } else if (cloud) {
      data = cloud.armorData;
      wishlist = cloud.wishlistData;
      bonusIcons = cloud.bonusIconsData;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(wishlist));
      localStorage.setItem(BONUS_ICONS_STORAGE_KEY, JSON.stringify(bonusIcons));
      render();
      renderWishlist();
      if (!hadSecret) pushToCloud();
    } else {
      // Nessuna copia cloud per questo codice: carica lo stato locale.
      pushToCloud();
    }

    ensureManifestLoaded().then(() => render()).catch(() => {});
  }

  init();
})();
