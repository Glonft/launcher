// Ostatnio znane kolory od serwera – nakładane od razu przy starcie, zanim launcher pobierze manifest (bez mignięcia).
try {
  const saved = JSON.parse(localStorage.getItem('melina.appearance') || 'null');
  if (saved && saved.colors && window.MelinaTheme) window.MelinaTheme.apply(saved.colors);
} catch { /* domyślny wygląd */ }
