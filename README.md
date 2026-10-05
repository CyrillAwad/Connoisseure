# Connoisseure

Statische Frontend-Demo. Die Website liegt als `index.html` im Repository-Root; ein Build-Schritt ist nicht erforderlich.

## Veröffentlichung mit GitHub Pages

1. In GitHub **Settings → Pages** öffnen.
2. Unter **Build and deployment → Source** die Option **GitHub Actions** auswählen.
3. Änderungen nach `main` pushen. Der Workflow **Deploy static site to GitHub Pages** veröffentlicht die Seite; alternativ lässt er sich unter **Actions** manuell starten.

Die Projektseite ist anschließend unter `https://scrabex.github.io/Connoisseure/` erreichbar. Das Frontend verwendet derzeit keine root-absoluten Asset- oder Navigationspfade und funktioniert daher auch unter dem Repository-Unterpfad.

Die Demo ist eigenständig und speichert Änderungen nicht dauerhaft; Backend- und Authentifizierungsintegration sind nicht Bestandteil dieser Veröffentlichung.
