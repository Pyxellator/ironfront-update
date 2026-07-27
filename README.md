# Ironfront Command

Erster Windows-Desktop-Prototyp für ein taktisches 3D-War-Game mit vier Fraktionen.

## Installieren

1. Öffne `release/Ironfront Command Setup 0.1.0.exe`.
2. Folge dem Installationsassistenten und wähle bei Bedarf Desktop- und Startmenü-Verknüpfungen.
3. Starte **Ironfront Command**.

## Bereits enthalten

- 3D-Karte mit Wasser, Straßen, Gelände und vier farbigen Dummy-Basen
- Lobby erstellen oder mit Code beitreten
- Vier Fraktionen, Fahrzeugauswahl für Panzer, Jet und Boot
- Fahrbarer Panzer-Prototyp (WASD/Pfeile, Shift für Turbo, Maus für Turm/Kamera)
- Firebase-Initialisierung mit anonymem Login und Firestore-Lobby-Dokumenten
- Lokaler Fallback, falls Firebase Auth oder Firestore noch nicht freigeschaltet ist

## Firebase für echte Mehrspieler-Lobbys freischalten

In der Firebase Console für `fake-war-thunder` bitte aktivieren:

1. **Authentication → Sign-in method → Anonymous**
2. **Firestore Database → Create database**

Dann den Inhalt von [firestore.rules](./firestore.rules) in Firebase Console → **Firestore Database → Regeln** einfügen und veröffentlichen. Die Regeln erlauben nur angemeldeten Spielern den Zugriff und verhindern, dass jemand die Daten anderer Spieler ändert.

Der Prototyp schreibt dann Lobbys nach `lobbies/{CODE}` und Spieler nach `lobbies/{CODE}/players/{UID}`. Für einen echten öffentlichen Release müssen die Firestore-Regeln vor dem Einsatz auf ein sicheres Matchmaking-Modell erweitert werden.

## Entwicklung und neuer Installer

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run dist:win
```

## Automatische Updates über GitHub

Die installierte App prüft beim Start auf neue [GitHub Releases](https://github.com/Pyxellator/ironfront-update/releases). Ein Push eines Versions-Tags wie `v0.2.0` startet den Workflow `.github/workflows/release.yml`; er baut das Windows-Setup und veröffentlicht Setup-Datei, Blockmap und `latest.yml` automatisch als GitHub Release. Die App lädt ein neues Release herunter und zeigt dann einen Installieren-Button an.
