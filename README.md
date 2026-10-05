# Connoisseure

Statische Frontend-Demo. Die Website liegt als `index.html` im Repository-Root; ein Build-Schritt ist nicht erforderlich.

## Veröffentlichung mit GitHub Pages

1. In GitHub **Settings → Pages** öffnen.
2. Unter **Build and deployment → Source** die Option **GitHub Actions** auswählen.
3. Änderungen nach `main` pushen. Der Workflow **Deploy static site to GitHub Pages** veröffentlicht die Seite; alternativ lässt er sich unter **Actions** manuell starten.

Die Projektseite ist anschließend unter `https://scrabex.github.io/Connoisseure/` erreichbar. Das Frontend verwendet derzeit keine root-absoluten Asset- oder Navigationspfade und funktioniert daher auch unter dem Repository-Unterpfad.

## Supabase

Das Frontend verwendet Supabase JS v2 über ein Browser-CDN und die öffentliche Publishable-Key-Konfiguration direkt in `app.js`. Es enthält weder den Gruppen-PIN noch einen Secret- oder `service_role`-Key. Der PIN wird ausschließlich im Anmeldeformular eingegeben; angemeldet wird mit dem fest konfigurierten gemeinsamen Gruppen-Konto.

Vor dem ersten Login muss dieses Auth-Konto in Supabase manuell angelegt werden (E-Mail `connoisseur.pro@gmx.de`, PIN als Passwort; Signups bleiben deaktiviert). Danach müssen die additiven Migrationen in `supabase/migrations/` angewendet werden: Sie erlauben den durch RLS beschränkten Mitglieder-Insert und tragen die vorhandene Gruppen-Auth-ID in `private.group_access` ein. Die Allowlist-Migration setzt voraus, dass das Auth-Konto bereits angelegt wurde. Die App nutzt `signInWithPassword` und navigiert dabei nicht per Auth-Redirect; **Authentication → URL Configuration** ist deshalb keine Voraussetzung für diesen Login. Site URL und Redirect-Allowlist sollten auf `https://scrabex.github.io/Connoisseure/` zeigen, falls später Bestätigungs-, Recovery- oder andere Redirect-Flows verwendet werden. Die erste Gruppenperson muss nicht vorab geseedet werden: Der erste Login kann den eigenen Vornamen direkt in der App eintragen.

Die App lädt Mitglieder, Fressungen, Teilnehmende und Bewertungen nach der Anmeldung aus dem bereits eingerichteten Schema. Sie fügt neue Fressungen als `waiting` ein und nutzt ausschließlich `start_meal` und `submit_meal_rating` für die durch RPC geschützten Schreibvorgänge. Weil alle Mitglieder dieselbe Auth-Identität verwenden, ist die ausgewählte Mitglieds-ID nur eine lokale Browser-Auswahl und kein individueller Identitätsnachweis.

## Restaurant-Suche mit OpenStreetMap

Das Formular fragt den öffentlichen Nominatim-Dienst von OpenStreetMap erst nach einem Klick auf **Suchen** (oder Enter) ab; es gibt keine Live-Suche während des Tippens. Die Anfrage liefert höchstens fünf Treffer. Anfragen werden im Tab serialisiert und, sofern unterstützt, browserübergreifend zwischen Tabs auf mindestens eine Sekunde Abstand begrenzt. Ergebnisse werden bis zu 24 Stunden lokal zwischengespeichert, und auf HTTP 429/503 wird mindestens eine Minute pausiert. Die Suchergebnisse zeigen die erforderliche Attribution zu [OpenStreetMap-Mitwirkenden](https://www.openstreetmap.org/copyright). Es ist weder API-Key noch Supabase-Schemaänderung erforderlich.

Der öffentliche Nominatim-Endpunkt ist kostenlos nutzbar, aber ein gemeinsamer Best-Effort-Dienst ohne Verfügbarkeitsgarantie; die Treffer hängen davon ab, was in OpenStreetMap eingetragen ist, daher bleiben alle Felder bearbeitbar und manuell ausfüllbar. Seine Grenze von maximal einer Anfrage pro Sekunde gilt für die gesamte Anwendung. Ein statisches Frontend kann gleichzeitige Zugriffe über verschiedene Geräte nicht zentral koordinieren oder die Gesamtgrenze garantieren. Deshalb ist diese Integration nur für gelegentliche Suchen einer kleinen Gruppe gedacht, nicht für viel oder automatisierten Traffic. Bei HTTP 429/503 nicht weiterprobieren; warten und Suchanfragen reduzieren. Details stehen in der [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/).
