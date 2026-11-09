# MelinaSMP Launcher

Launcher serwera **MelinaSMP** (`pl20.icehost.pl:50094`, NeoForge 1.21.1).

- Logowanie kontem Microsoft (premium) lub nickiem (non-premium).
- Automatyczna synchronizacja modów z [Glonft/modpack](https://github.com/Glonft/modpack).
- Sam pobiera Javę 21 i NeoForge, łączy od razu z serwerem.
- Sam się aktualizuje (pasek u góry z przyciskiem „Uruchom ponownie i zaktualizuj”).
- Status serwera na żywo: online/offline, liczba graczy, ping i nicki graczy.
- Aktualności z repo modpack (`news.md`).
- Wiele kont i szybkie przełączanie.
- Dodatki do włączenia (shadery, resourcepacki) i przycisk „Napraw instalację”.

## Dla graczy

Strona serwera: https://glonft.github.io/modpack/

Bezpośredni link: https://github.com/Glonft/launcher/releases/latest/download/MelinaSMP-Launcher-Setup.exe

Przy pierwszym uruchomieniu Windows może pokazać „System Windows ochronił ten komputer”.
Kliknij **Więcej informacji → Uruchom mimo to** (launcher nie jest podpisany certyfikatem).
Pierwsze uruchomienie trwa dłużej, bo launcher pobiera Javę, NeoForge i około 450 MB modów.

Pliki gry są domyślnie w `%APPDATA%\.melinasmp`. W **⚙ Ustawieniach** zmienisz RAM, rozdzielczość,
folder instalacji (z przeniesieniem plików) i zachowanie launchera po starcie gry.

## Dla admina

- Konfiguracja: `config.json` (adres serwera, URL manifestu, domyślny RAM).
  Ustawienia gracza są w `%APPDATA%\MelinaSMP Launcher\settings.json`.
- Nowa wersja launchera: podbij `version` w `package.json` i zrób push na `main`.
  GitHub Actions zbuduje instalatory i utworzy wydanie `v<wersja>`.
- Lokalnie (Node 20+): `npm install`, potem `npm start`.

### Logowanie Microsoft

Biblioteka `msmc` domyślnie używa publicznego client ID. Docelowo zarejestruj własną aplikację
w Azure (Entra ID → App registrations), złóż wniosek do Mojang o dostęp do Minecraft API
i wpisz ID w `microsoftClientId`.

### Non-premium

Serwer wpuszcza graczy bez premium, więc **na serwerze musi działać mod logowania hasłem**
(`/register`, `/login`). Bez niego każdy może wejść na cudzy nick.
