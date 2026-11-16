# ORIOKO FT – Netlify + Google Sheets

Fitxategiak: `public/index.html` (formularioa), `netlify/functions/api.mjs` (zerbitzaria), `netlify.toml` (Netlify konfigurazioa).

## Google Sheets
Lehendik dagoen kalkulu-orria erabil dezakezu. Bi fitxa behar ditu:

`Partidak`: A `Partida ID`, B `Partida`, C `Data`, D `Egoera`.

`Erantzunak`: A `Partida ID`, B `Partida`, C `Ahalegina`, D `Norberaren jarduna`, E `Eginkizun taktikoak`, F `Taldearen jarduna`, G `Sentsazioak`, H `Ondo egindakoa`, I `Hobetu beharrekoa`, J `Entrenatzaileentzako oharrak`.

Erabili `IREKITA` D zutabean partida aktibatzeko, `ITXITA` ixteko. ID bakoitza bakarra izan behar da.

## Google Cloud
1. https://console.cloud.google.com -> proiektua sortu.
2. APIs & Services -> Library -> Google Sheets API -> Enable.
3. IAM & Admin -> Service Accounts -> Create service account, adibidez `orioko-ft-balorazioak`.
4. Sortutako kontua ireki -> Keys -> Add key -> Create new key -> JSON. **Ez igo JSON fitxategia GitHubera edo Netlifyko web-fitxategietara**.
5. Google Sheets-en `Compartir` sakatu, eta service account-en `client_email` helbidea `Editor` bezala gehitu.
6. Sheets URL honetatik hartu IDa: `https://docs.google.com/spreadsheets/d/HEMEN_DAGO_IDa/edit`.

## Netlify
1. Jarri proiektu honen fitxategiak GitHubeko repository PRIBATU batean. Ez igo deskargatutako JSON gakoa.
2. https://app.netlify.com -> Add new project -> Import an existing project -> GitHub -> aukeratu repo-a.
3. Build command: hutsik; Publish directory: `public`; Functions directory: `netlify/functions` (netlify.toml-k konfiguratuak).
4. Netlify -> Project configuration -> Environment variables -> Add variable (Functions-ek eskuragarri):
   - `GOOGLE_SHEET_ID`: kalkulu-orriaren IDa.
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: JSONeko `client_email`.
   - `GOOGLE_PRIVATE_KEY`: JSONeko `private_key` balioa (BEGIN PRIVATE KEY eta END PRIVATE KEY barne). `\\n` literalekin edo benetako lerro-jauziekin onartzen da.
5. Zabaldu berriro (Deploys -> Trigger deploy -> Deploy project) aldagaiak jarri ostean.
6. Ireki `https://zure-gunea.netlify.app` eta probatu partida bat eta balorazioa.

## Segurtasun eta anonimotasun oharra
Ez da izenik, emailik edo IP helbiderik idazten Sheets-en. Hala ere, host plataformaren erregistro teknikoek metadatuak izan ditzakete; testu libreek pertsonak identifika ditzakete; anonimotasun absoluturik ez dago. Formulario publikoa denez, erabiltzaile batek erantzun bat baino gehiago bidal dezake. Aurkezpena eta erantzunen bistaratzea soilik entrenatzaile-taldearekin partekatu. Google Sheets ez jarri publiko.

Emaitzetan testu libreko mezuak gutxieneko talde-kopuruarekin berrikusi eta saihestu testu pertsonalak partekatzea.
