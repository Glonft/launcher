// Język launchera: PL (domyślnie) albo EN. Tłumaczymy gotowe napisy na ekranie – także te, które kod
// wstawia później – więc reszta launchera nie musi nic wiedzieć o języku.
(function () {
  const EN = {
    // pasek boczny, okno
    'Graj': 'Play', 'Uruchom grę': 'Launch game', 'Gra uruchomiona': 'Game running', 'Gracze online': 'Players online', 'Pamięć dla gry': 'Memory for the game', 'Status serwera': 'Server status', 'Gracze': 'Players', 'Wydarzenia': 'Events', 'Dodatki': 'Add-ons', 'Changelog': 'Changelog',
    'Moje mody': 'My mods', 'Ustawienia': 'Settings', 'Wyloguj': 'Log out', 'Skin i peleryna': 'Skin & cape',
    'Minimalizuj': 'Minimize', 'Maksymalizuj': 'Maximize', 'Przywróć': 'Restore', 'Zamknij': 'Close', 'Menu': 'Menu',
    'Język': 'Language', 'Język / Language': 'Język / Language',
    // ekran Start
    'Status': 'Status', 'Ping': 'Ping', 'Online': 'Online', 'Offline': 'Offline', 'Gotowy': 'Ready',
    'Odśwież status': 'Refresh status', 'Więcej': 'More', 'Więcej opcji': 'More options',
    'Uruchom bez moich modów': 'Launch without my mods', 'Napraw pliki gry': 'Repair game files',
    'Otwórz folder gry': 'Open game folder', 'Pokaż log': 'Show log', 'Ukryj log': 'Hide log', 'Log': 'Log', 'Zamknij log': 'Close log',
    'Przeglądaj': 'Browse', 'Wszystkie': 'All', 'Najnowsze wydarzenia': 'Latest events', 'Czytaj więcej': 'Read more',
    'Brak aktualności.': 'No news yet.', 'Ładowanie…': 'Loading…', 'Poprzednie': 'Previous', 'Następne': 'Next',
    'Społeczność': 'Community', 'Dołącz do naszego Discorda': 'Join our Discord', 'Kliknij, żeby dołączyć!': 'Click to join!',
    'Uruchamianie jako': 'Launching as', 'Anuluj': 'Cancel', 'Proszę czekać…': 'Please wait…',
    'Nie masz jeszcze własnych modów – dodaj minimapę, zoom albo shadery.': "You don't have any mods of your own yet – add a minimap, zoom or shaders.",
    'Zaktualizuj': 'Update', 'Później': 'Later', 'Uruchom ponownie i zaktualizuj': 'Restart and update', 'Pokaż plik': 'Show file',
    'Masz najnowszą wersję launchera.': 'You have the latest launcher version.', 'Tryb deweloperski – aktualizacje wyłączone.': 'Developer mode – updates disabled.',
    // gracze
    'Wczytuję listę graczy…': 'Loading players…', 'Nikogo nie ma – bądź pierwszy!': 'Nobody is online – be the first!',
    'gracz': 'player', 'gracze': 'players', 'graczy': 'players',
    // changelog
    'Launcher': 'Launcher', 'Server': 'Server', 'Brak wpisów.': 'No entries.',
    'Administracja nie dodała jeszcze żadnych zmian serwera.': "The admins haven't added any server changes yet.",
    'Co nowego': "What's new", 'OK': 'OK', 'Pełna lista zmian': 'Full changelog',
    // logowanie
    'Logowanie do': 'Log in to', 'Zaloguj się do launchera korzystając z jednego z dostępnych sposobów': 'Log in to the launcher using one of the available methods',
    'Zapisane konta': 'Saved accounts', 'lub nowe konto': 'or a new account', 'lub': 'or', 'albo': 'or',
    'Podaj nick (non-premium)': 'Enter your nickname (non-premium)', 'Zaloguj się przez Microsoft (premium)': 'Log in with Microsoft (premium)',
    'Konto Microsoft': 'Microsoft account', 'Konto non-premium': 'Non-premium account', 'Konto serwera': 'Server account', 'Konto bez hasła': 'Account without password',
    'Podaj nick': 'Enter your nickname', 'Podaj hasło': 'Enter your password', 'Zapamiętaj mnie': 'Remember me', 'Zaloguj się': 'Log in',
    'Zapomniałem hasła': 'I forgot my password', 'Zaloguj się przez Microsoft': 'Log in with Microsoft', 'Nie masz konta?': "Don't have an account?",
    'Zarejestruj się': 'Sign up', 'Wróć do logowania': 'Back to login', 'Nick lub e-mail...': 'Nickname or e-mail...', 'Wyślij link': 'Send link',
    'Podaj swój nick z gry lub e-mail przypisany do konta, a wyślemy ci link do zresetowania hasła.': "Enter your in-game nickname or the e-mail linked to your account and we'll send you a password reset link.",
    'Rejestracja': 'Sign up', 'Konto dla graczy bez Minecrafta premium.': 'An account for players without Minecraft premium.',
    'Podaj nick...': 'Enter nickname...', 'Podaj email...': 'Enter e-mail...', 'Podaj hasło...': 'Enter password...', 'Powtórz hasło...': 'Repeat password...',
    'Masz już konto?': 'Already have an account?', 'Pokaż hasło': 'Show password', 'Ukryj hasło': 'Hide password',
    'Uzupełnij wszystkie pola': 'Fill in all fields', 'Hasła nie są takie same': "Passwords don't match", 'Niepoprawny adres e-mail': 'Invalid e-mail address',
    'Hasło musi mieć co najmniej 8 znaków': 'Password must be at least 8 characters', 'Nick: 3–16 znaków, tylko litery, cyfry i _': 'Nickname: 3–16 characters, letters, digits and _ only',
    'Nieprawidłowy nick lub hasło.': 'Wrong nickname or password.', 'Jeśli konto istnieje, wysłaliśmy link na podany adres.': "If the account exists, we've sent a link to its e-mail.",
    'Ten nick jest już zajęty.': 'This nickname is already taken.', 'Ten e-mail jest już przypisany do innego konta.': 'This e-mail is already used by another account.',
    'Podaj hasło, żeby zalogować się na to konto.': 'Enter the password to log in to this account.', 'Sesja wygasła – zaloguj się ponownie.': 'Session expired – please log in again.',
    'Brak połączenia z serwerem logowania. Sprawdź internet i spróbuj ponownie.': 'Cannot reach the login server. Check your internet connection and try again.',
    'Za dużo prób – spróbuj ponownie za kilka minut.': 'Too many attempts – try again in a few minutes.',
    // dodatki
    'Dodatkowe pliki od administracji, które możesz włączyć, jeśli chcesz. Zmiany zadziałają przy najbliższym kliknięciu „Graj”.': 'Extra files from the admins that you can turn on if you like. Changes apply the next time you click “Play”.',
    'Paczka nie ma jeszcze dodatków do wyboru.': 'The pack has no optional add-ons yet.',
    'Zastąpi Twoje obecne dane tego dodatku (kopia zostanie zachowana jako plik .kopia). Pobiera się w tle – możesz grać w trakcie.': 'Replaces your current data for this add-on (a backup is kept as a .kopia file). Downloads in the background – you can play meanwhile.',
    'Włączasz i wyłączasz w oknie Dodatki (pasek boczny)': 'Turn it on and off on the Add-ons page (sidebar)',
    // moje mody
    'Mody': 'Mods', 'Shadery': 'Shaders', 'Paczki tekstur': 'Resource packs', 'Zainstalowane': 'Installed', 'więcej': 'more',
    'Sortuj': 'Sort', 'Sortowanie': 'Sorting', 'Najpopularniejsze': 'Most popular', 'Najnowsze': 'Newest', 'Ostatnio zaktualizowane': 'Recently updated',
    'Kategorie': 'Categories', 'Przeciągnij tutaj plik': 'Drop a file here:', 'wybierz z dysku': 'pick from disk',
    'Szukaj': 'Search', 'Szukaj w Modrinth, np. minimap, zoom, sound…': 'Search Modrinth, e.g. minimap, zoom, sound…',
    'Szukaj shaderów, np. Complementary, BSL…': 'Search shaders, e.g. Complementary, BSL…',
    'Szukaj paczek tekstur, np. Faithful, Fresh Animations…': 'Search resource packs, e.g. Faithful, Fresh Animations…',
    'Szukaj wśród zainstalowanych modów…': 'Search installed mods…', 'Twoje mody': 'Your mods', 'Sprawdź aktualizacje': 'Check for updates',
    'Popularne w Modrinth': 'Popular on Modrinth', 'Pokaż więcej': 'Show more', 'Zainstaluj': 'Install', 'Odinstaluj': 'Uninstall',
    'Wyłącz': 'Disable', 'Włącz': 'Enable', 'wyłączony': 'disabled', 'Dodaję…': 'Adding…', 'W paczce 🔒': 'In pack 🔒', 'z dysku': 'from disk',
    'Otwórz stronę na Modrinth': 'Open the Modrinth page', 'Ten mod jest już w paczce serwera': 'This mod is already in the server pack',
    'Nie masz jeszcze własnych modów.': "You don't have any mods of your own yet.", 'Nie masz jeszcze shaderów.': "You don't have any shaders yet.",
    'Nic nie znaleziono. Spróbuj innej nazwy (najlepiej po angielsku) albo innej kategorii.': 'Nothing found. Try another name or category.',
    'Brak informacji o modach – uruchom grę przynajmniej raz.': 'No mod information – launch the game at least once.',
    'Shadery działają tylko z modem Iris. Zainstalować też Iris?': 'Shaders only work with the Iris mod. Install Iris too?',
    'Mody tylko dla Ciebie, np. minimapa, zoom albo lepsze dźwięki. Mody oznaczone „wymaga serwera” muszą być też na serwerze – bez tego możesz nie wejść do gry.': 'Mods just for you, e.g. a minimap, zoom or better sounds. Mods marked “requires server” must also be on the server – otherwise you may not be able to join.',
    'Shadery zmieniają oświetlenie, cienie i wodę. Potrzebują moda Iris – launcher zaproponuje go przy pierwszym shaderze. Włączasz je w grze: Opcje → Ustawienia grafiki → Paczki shaderów.': 'Shaders change lighting, shadows and water. They need the Iris mod – the launcher will offer it with your first shader. Turn them on in game: Options → Video Settings → Shader Packs.',
    'Paczki tekstur zmieniają wygląd bloków, przedmiotów i interfejsu. Włączasz je w grze: Opcje → Paczki zasobów.': 'Resource packs change how blocks, items and the interface look. Turn them on in game: Options → Resource Packs.',
    'Wszystkie mody, które masz w grze. Mody z kłódką dodała administracja serwera – są potrzebne do gry i nie da się ich usunąć. Swoje mody możesz wyłączać i usuwać.': 'All mods in your game. Mods with a padlock were added by the server admins – they are required and cannot be removed. You can disable and remove your own mods.',
    'Wydajność': 'Performance', 'Przydatne': 'Utility', 'Dekoracje': 'Decoration', 'Wyposażenie': 'Equipment', 'Technologia': 'Technology',
    'Magia': 'Magic', 'Przygoda': 'Adventure', 'Świat': 'World', 'Moby': 'Mobs', 'Jedzenie': 'Food', 'Dźwięki': 'Sounds', 'Biblioteki': 'Libraries',
    'Kreskówkowe': 'Cartoon', 'Półrealistyczne': 'Semi-realistic', 'Realistyczne': 'Realistic', 'Bardzo słaby PC': 'Very weak PC', 'Słaby PC': 'Weak PC', 'Średni PC': 'Mid-range PC', 'Mocny PC': 'Powerful PC',
    // skin
    'Skin': 'Skin', 'Peleryna': 'Cape', 'Wybierz plik PNG…': 'Choose PNG file…', 'Klasyczny (Steve)': 'Classic (Steve)', 'Smukły (Alex)': 'Slim (Alex)',
    'Przywróć domyślnego skina': 'Restore default skin', 'Przywróć domyślnego skina (komenda)': 'Restore default skin (command)',
    'Przywrócić domyślnego skina (Steve/Alex)?': 'Restore the default skin (Steve/Alex)?', 'Zapisz zmiany': 'Save changes',
    'Przeciągnij myszką, żeby obrócić': 'Drag to rotate', 'Podgląd 2D (3D niedostępne)': '2D preview (3D unavailable)',
    'To konto nie ma żadnej oficjalnej peleryny.': 'This account has no official capes.', 'Sprawdzam, czy coś się zmieniło…': 'Checking for changes…',
    'Zmiany dotyczą całego Twojego konta Minecraft (tak jak w oficjalnym launcherze). Na serwerze zobaczysz je po ponownym wejściu.': 'Changes apply to your whole Minecraft account (like in the official launcher). You will see them on the server after rejoining.',
    'Konto non-premium: skin zobaczą wszyscy na serwerze MelinaSMP. Po kliknięciu „Zapisz zmiany” wkleisz w grze jedną komendę. Peleryny są dostępne tylko dla kont premium.': 'Non-premium account: everyone on the MelinaSMP server will see your skin. After clicking “Save changes” you paste one command in game. Capes are only available for premium accounts.',
    'Przygotowywanie skina (MineSkin)… to może potrwać kilkanaście sekund': 'Preparing skin (MineSkin)… this may take a few seconds',
    '✔ Przywrócono domyślnego skina.': '✔ Default skin restored.', '✔ Zapisano! Wejdź ponownie na serwer, żeby zobaczyć zmiany w grze.': '✔ Saved! Rejoin the server to see the changes in game.',
    '✔ Skin gotowy, komenda jest już w schowku. W grze na serwerze:': '✔ Skin ready, the command is in your clipboard. In game on the server:',
    'Ostatnia komenda skina. Żeby ustawić go na serwerze:': 'Last skin command. To set it on the server:', 'naciśnij T (czat)': 'press T (chat)',
    '📋 Kopiuj komendę': '📋 Copy command', '✔ Skopiowano': '✔ Copied',
    // ustawienia
    'Alokacja RAM': 'RAM allocation', 'Dla gry:': 'For the game:', 'Tryb wyświetlania gry': 'Game display mode', 'Okno': 'Window', 'Pełny ekran': 'Fullscreen',
    'Szerokość': 'Width', 'Wysokość': 'Height', 'Rozmiar interfejsu': 'Interface size', 'Automatycznie (dopasowany do monitora)': 'Automatic (fits your monitor)',
    'Skróty: Ctrl + / Ctrl − powiększa i pomniejsza, Ctrl 0 wraca do automatycznego.': 'Shortcuts: Ctrl + / Ctrl − zoom in and out, Ctrl 0 goes back to automatic.',
    'Po uruchomieniu gry': 'After the game starts', 'Zminimalizuj launcher': 'Minimize the launcher', 'Zostaw launcher otwarty': 'Keep the launcher open',
    'Wygląd launchera': 'Launcher appearance', 'Animacje': 'Animations', 'Płynne przejścia między stronami. Wyłącz na słabszym komputerze.': 'Smooth transitions between pages. Turn off on a slower computer.',
    'Discord': 'Discord', 'Discord Rich Presence': 'Discord Rich Presence', 'Pokazuj na Discordzie, że korzystasz z launchera.': 'Show on Discord that you are using the launcher.',
    'Przycisk „Dołącz do Discorda” w statusie': '“Join Discord” button in your status',
    'Inni zobaczą pod Twoim statusem przycisk z zaproszeniem na nasz serwer Discord.': 'Others will see a button with an invite to our Discord server under your status.',
    'Konta': 'Accounts', '+ Dodaj konto': '+ Add account', 'Usuń': 'Remove', 'Usuń konto z launchera': 'Remove the account from the launcher', 'Użyj': 'Use', 'aktywne': 'active',
    'Folder instalacji': 'Install folder', 'Zmień…': 'Change…', 'Nowy folder:': 'New folder:', 'Przenieś obecne pliki gry (mody, Javę, światy, ustawienia)': 'Move current game files (mods, Java, worlds, settings)',
    'Zastosuj': 'Apply', 'Przywróć domyślny folder': 'Restore default folder', 'Naprawa i aktualizacje': 'Repair and updates', '🔧 Napraw instalację': '🔧 Repair installation',
    'Sprawdź aktualizacje launchera': 'Check for launcher updates',
    'Naprawa pobiera od nowa Javę, silnik gry (np. NeoForge) i biblioteki oraz sprawdza wszystkie mody. Światy i ustawienia zostają.': 'Repair downloads Java, the game engine (e.g. NeoForge) and libraries again and checks all mods. Worlds and settings stay.',
    'Zaawansowane': 'Advanced', 'Dodatkowe argumenty Javy (oddzielone spacją)': 'Extra Java arguments (separated by spaces)', 'np. -XX:+UseZGC': 'e.g. -XX:+UseZGC',
    'Zapisz': 'Save', '✔ Zapisano': '✔ Saved', 'Błąd: ': 'Error: ', 'BŁĄD: ': 'ERROR: ',
  };
  const PATTERNS = [
    [/^Wersja (\S+)$/, 'Version $1'],
    [/^(\d+) (gracz|gracze|graczy)$/, (m, n) => `${n} ${n === '1' ? 'player' : 'players'}`],
    [/^Dołącz do (\d+) osób na naszym Discordzie!$/, 'Join $1 people on our Discord!'],
    [/^Twój komputer ma (.+) GB RAM\.$/, 'Your computer has $1 GB of RAM.'],
    [/^Dostępna nowa wersja (\S+)$/, 'New version $1 available'],
    [/^Dostępna wersja (\S+)$/, 'Version $1 available'],
    [/^Wersja (\S+) gotowa$/, 'Version $1 ready'],
    [/^Wersja (\S+) pobrana – kliknij „Uruchom ponownie i zaktualizuj” na górze\.$/, 'Version $1 downloaded – click “Restart and update” at the top.'],
    [/^Pokaż wszystkie \((\d+)\)$/, 'Show all ($1)'],
    [/^Wszystkie \((\d+)\)$/, 'All ($1)'],
    [/^Wyniki dla „(.*)”$/, 'Results for “$1”'],
    [/^Twoje mody \((\d+)\)$/, 'Your mods ($1)'],
    [/^Twoje shadery \((\d+)\)$/, 'Your shaders ($1)'],
    [/^Twoje paczki tekstur \((\d+)\)$/, 'Your resource packs ($1)'],
    [/^Zainstalowane mody \((\d+)\)$/, 'Installed mods ($1)'],
    [/^Popularne (mody|shadery|paczki tekstur) w Modrinth(.*)$/, (m, w, rest) => `Popular ${{ mody: 'mods', shadery: 'shaders', 'paczki tekstur': 'resource packs' }[w]} on Modrinth${rest}`],
    [/^Ten serwer wymaga launchera (\S+) lub nowszego\. Zaktualizuj launcher, żeby zagrać\.$/, 'This server requires launcher $1 or newer. Update the launcher to play.'],
    [/^Serwer jest offline(.*)\.$/, 'The server is offline$1.'],
    [/^i (\d+) (inny|innych)$/, 'and $1 more'],
    [/^Co nowego w wersji (\S+)$/, "What's new in version $1"],
    [/^Lista zmian$/, 'Changelog'],
  ];
  const ATTRS = ['placeholder', 'title', 'aria-label', 'data-tip'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'TEXTAREA']);
  let lang = 'pl';
  let busy = false;
  const orig = new WeakMap(); // węzeł tekstowy → { pl, en }

  function tr(text) {
    const k = text.trim();
    if (!k) return null;
    let r = EN[k];
    if (r === undefined) {
      for (const [re, rep] of PATTERNS) { if (re.test(k)) { r = k.replace(re, rep); break; } }
    }
    return r === undefined ? null : text.replace(k, r);
  }
  function doText(n) {
    if (n.parentNode && SKIP.has(n.parentNode.nodeName)) return;
    const o = orig.get(n);
    if (lang === 'en') {
      if (o && n.nodeValue === o.en) return;
      const t = tr(n.nodeValue);
      if (t !== null) { orig.set(n, { pl: n.nodeValue, en: t }); n.nodeValue = t; }
    } else if (o && n.nodeValue === o.en) {
      n.nodeValue = o.pl;
      orig.delete(n);
    }
  }
  function doAttrs(e) {
    for (const a of ATTRS) {
      if (!e.hasAttribute || !e.hasAttribute(a)) continue;
      const key = `data-pl-${a}`;
      if (lang === 'en') {
        const cur = e.getAttribute(a);
        if (e.hasAttribute(key) && cur === e.getAttribute(`data-en-${a}`)) continue;
        const t = tr(cur);
        if (t !== null) { e.setAttribute(key, cur); e.setAttribute(`data-en-${a}`, t); e.setAttribute(a, t); }
      } else if (e.hasAttribute(key)) {
        if (e.getAttribute(a) === e.getAttribute(`data-en-${a}`)) e.setAttribute(a, e.getAttribute(key));
        e.removeAttribute(key); e.removeAttribute(`data-en-${a}`);
      }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
    doAttrs(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n = it.nextNode();
    while (n) {
      if (n.nodeType === 3) doText(n); else if (!SKIP.has(n.nodeName)) doAttrs(n);
      n = it.nextNode();
    }
  }
  function run(fn) { busy = true; try { fn(); } finally { busy = false; } }
  const obs = new MutationObserver((list) => {
    if (busy || lang === 'pl') return;
    run(() => {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    });
  });
  function set(l) {
    lang = l === 'en' ? 'en' : 'pl';
    document.documentElement.lang = lang;
    run(() => walk(document.body));
    const b = document.getElementById('btn-lang');
    if (b) b.textContent = lang.toUpperCase();
  }
  window.I18N = { set, get: () => lang, tr: (t) => (lang === 'en' ? (tr(t) ?? t) : t) };
  document.addEventListener('DOMContentLoaded', () => {
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  });
})();
