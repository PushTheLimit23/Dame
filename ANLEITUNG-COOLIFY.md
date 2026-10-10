# Dame auf dem VPS mit Coolify

Gleiches Muster wie bei Vier Gewinnt – nur mit eigenem Repository und eigener Subdomain.
Beide Spiele laufen danach nebeneinander auf demselben Server; Coolify (Traefik) verteilt die Anfragen anhand der Domain.

## 1. Subdomain anlegen (IONOS)

IONOS → **Domains & SSL** → deine Domain → **DNS** → **Eintrag hinzufügen**:

| Typ | Hostname | Zeigt auf |
|---|---|---|
| A | `dame` | IP-Adresse deines VPS (dieselbe wie bei `vier`) |

Bis der Eintrag aktiv ist, dauert es meist 5–30 Minuten.

## 2. Code auf GitHub hochladen

1. Zip entpacken.
2. Auf GitHub **New repository** → Name `dame` → *Private* → **Create repository**.
3. **uploading an existing file** → den **Inhalt** des Ordners `dame` hineinziehen (`server.js`, `package.json`, `Dockerfile`, `.dockerignore`, Ordner `public`) → **Commit changes**.

Wichtig: `Dockerfile` muss direkt im Hauptverzeichnis des Repositorys liegen, nicht in einem Unterordner.
Hinweis: `.dockerignore` ist eine „versteckte“ Datei. Wird sie beim Upload nicht mitgenommen, ist das unkritisch.

## 3. Neue Ressource in Coolify

1. Dein Projekt öffnen (oder ein neues `Spiele`-Projekt) → **+ New** → dieselbe Repository-Variante wählen wie bei Vier Gewinnt (Public Repository oder Private Repository mit GitHub App).
2. Repository `dame`, Branch `main`.
3. **Build Pack: „Dockerfile“** (nicht Nixpacks!).
4. **Continue / Save**.

## 4. Einstellungen

Tab **Configuration → General**:

| Feld | Wert |
|---|---|
| **Domains** | `https://dame.deine-domain.de` (mit `https://`!) |
| **Ports Exposes** | `3000` |

→ **Save**. Dass Vier Gewinnt ebenfalls Port 3000 nutzt, ist kein Problem: Jede App hat ihren eigenen Container.

Tab **Persistent Storage** → **+ Add → Volume Mount**:

- Name: `dame-daten`
- **Destination Path:** `/app/data`
- → **Save**

Ohne diesen Schritt ist die Spielhistorie nach jedem Update weg.

## 5. Deploy

Oben **Deploy** klicken. Fertig, wenn im **Logs**-Tab steht: `Dame läuft auf Port 3000`.

Dann **https://dame.deine-domain.de** öffnen → Namen eingeben → **Neue Partie starten** → **Einladen** tippen und Link verschicken.

## Wenn etwas nicht klappt

| Symptom | Wahrscheinliche Ursache |
|---|---|
| Seite lädt gar nicht | DNS-Eintrag noch nicht aktiv |
| „404 page not found“ | Domain-Feld prüfen (mit `https://`), dann Redeploy |
| „Bad Gateway“ | Ports Exposes ist nicht `3000` oder Container abgestürzt → Logs |
| Zertifikatswarnung bleibt | DNS war beim Deploy noch nicht aktiv → Redeploy |
| „Verbindung unterbrochen“ oben im Spiel | WebSocket blockiert → Logs + Screenshot an Claude |
