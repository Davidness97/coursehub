# CourseHub

CourseHub è una web application self-hosted e containerizzata per organizzare e seguire corsi personali presenti in cartelle locali o su NAS.

## Installazione

Puoi eseguire CourseHub in due modalità: tramite Docker Compose (consigliato per l'uso finale) o direttamente su Windows per lo sviluppo.

### Modalità 1: Docker Compose

1. Clona il repository o scarica i file.
2. Apri `docker-compose.yml` e modifica i percorsi nei `volumes` in base alle cartelle sul tuo host:
   ```yaml
   volumes:
     - /percorso/host/corsi:/courses:ro
     - /percorso/host/coursehub-data:/data
   ```
3. Avvia il container:
   ```bash
   cd /opt/coursehub
   sudo docker compose up -d --build --force-recreate
   ```
4. Apri `http://localhost:3000` nel browser.

### Modalità 2: Sviluppo locale su Windows

Questa modalità è utile per lo sviluppo o il debug, avviando Node.js direttamente.

1. Installa Node.js (versione 20 LTS o superiore).
2. Clona il repository ed entra nella cartella del progetto.
3. Installa le dipendenze:
   ```bash
   npm install
   ```
4. Copia il file `.env.example` in `.env` e configura i percorsi:
   ```env
   COURSES_PATH=C:\percorso\ai\tuoi\corsi
   DATA_PATH=C:\percorso\dove\salvare\i\dati
   PORT=3000
   ```
5. Avvia l'applicazione:
   ```bash
   npm start
   # oppure per sviluppo con auto-reload:
   npm run dev
   ```
6. Apri `http://localhost:3000` nel browser.

## Struttura e Sicurezza

- La cartella `/courses` (o `COURSES_PATH`) è esplorabile in sola lettura.
- Nessun file dei corsi verrà mai modificato, spostato o eliminato dall'app.
- Tutti i dati dell'applicazione (database, progressi, note, copertine caricate) risiedono in `/data` (o `DATA_PATH`).

## Aggiornamento e Troubleshooting

Per applicare modifiche al codice e aggiornare l'ambiente Docker, esegui:
```bash
sudo docker compose up -d --build --force-recreate
```
I tuoi dati, note e progressi non andranno persi perché sono salvati nel volume persistente `/data`.
