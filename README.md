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

## Restaurant-Suche mit Google Maps

Das Formular für neue Fressungen kann Google Places für Restaurant-, Café- und Barsuche verwenden. Bei Auswahl eines Treffers werden Restaurantname, Adresse und Maps-Link in die vorhandenen Felder übernommen; ohne API-Key bleibt die manuelle Eingabe verfügbar. Dafür in Google Cloud Billing aktivieren sowie **Maps JavaScript API** und **Places API (New)** freischalten. Einen Browser-Key erstellen, HTTP-Referrer auf `https://scrabex.github.io/Connoisseure/*` beschränken und die API-Nutzung auf diese beiden APIs beschränken. Den Key in `index.html` im Meta-Element `google-maps-api-key` einsetzen. Browser-Keys sind für Besucher sichtbar; die Referrer- und API-Beschränkungen sind daher wichtig. Google Maps API-Nutzung kann Kosten verursachen; vor dem Aktivieren sollten Budgetwarnungen und Quotas gesetzt werden. Für lokale Vorschau zusätzlich deren Origin als Referrer zulassen.
