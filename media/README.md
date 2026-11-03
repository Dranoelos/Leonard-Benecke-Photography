# Medien der Website

Alle aktiven Medien liegen zentral in diesem Ordner:

```text
media/
  images/
    events/       Eventfotos und neue Event-Uploads
    portraits/    Portraitfotos und neue Portrait-Uploads
    cover/        Aktuelles Video- und Social-Media-Vorschaubild
  videos/
    cover/
      cover-hdr.mp4
      cover-sdr.mp4
      cover-hdr-low.mp4
      cover-sdr-low.mp4
```

Die vier Videos sind die aktuell verwendeten komprimierten Varianten. HDR/SDR und die kleineren Versionen für langsame Verbindungen werden weiterhin automatisch gewählt. Das aktuelle Vorschaubild ist `images/cover/cover-video-first-frame-20261026.jpg`.

`images/` und `images_October26/` im Projekt-Hauptordner wurden zusammengeführt. Die beiden alten Videodateien `CoverVideoHDR.mp4` und `CoverVideoSDR.mp4` sowie die großen Oktober-Ausgangsdateien `cover video HDR.mp4` und `SDR.mp4` wurden am 3. November 2026 nach `Papierkorb/media-editor-20261103-003034/removed-media/` verschoben. Die früheren komprimierten Cover-Videos waren bereits unter `Papierkorb/cover-video-20261015-154628/` gesichert. Kein Video wurde endgültig gelöscht.

Die vollständige Zuordnung und SHA-256-Prüfsummen des Umzugs stehen in `Papierkorb/media-editor-20261103-003034/media-before.json` und `media-moves.json`. Alte Sicherungen behalten ihre damaligen Pfade und wurden nicht umgeschrieben.

Die Auswahl und Reihenfolge der Galeriefotos stehen in `gallery-data.js` im Projekt-Hauptordner. Zum Verwalten **Galerie sortieren.command** starten; weitere Hinweise stehen in `tools/gallery-editor/README.md`. Ausblenden schützt nicht vor direktem Zugriff auf die Datei, sondern entfernt sie nur aus der Galerie. Nach einem späteren Veröffentlichen können bereits öffentlich geteilte URLs und Browserkopien weiterhin existieren.

Bei der Abschlussprüfung waren die zunächst erfolgreich umgezogenen älteren Coverbilder `0010.jpg`, `cover-video-poster-20261018.jpg` und `oldcover.jpg` nicht mehr vorhanden. Der Editor bearbeitet ausschließlich Event- und Portraitfotos. Die Social-Media- und strukturierten Vorschaubild-Verweise wurden deshalb auf das vorhandene aktuelle Video-Vorschaubild umgestellt. Die Umzugsprotokolle dokumentieren weiterhin den ursprünglichen Umzugsstand.
