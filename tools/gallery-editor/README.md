# Lokaler Galerie-Editor

Im Projektordner **Galerie sortieren.command** doppelklicken. Die Vorschau öffnet sich im Browser. Alternativ: `python3 tools/gallery-editor/server.py`.

## Bilder verwalten

- **Events / Portraits:** Zielgalerie auswählen. Bilder ziehen oder mit den Pfeilen verschieben.
- **Zwischen Tabs verschieben:** Ein vorhandenes Bild direkt auf einen anderen Tab ziehen oder unter dem Bild „Verschieben nach …“ auswählen. Das Bild wird am Ende der Zielgalerie eingeordnet. Ausgeblendete Bilder bleiben ausgeblendet. Datei, Beschreibung und Abmessungen bleiben erhalten; der Dateipfad ändert sich nicht.
- **+ Neuer Tab:** Einen Namen eingeben, etwa „Hochzeiten“. Der neue Tab kann sofort Bilder aufnehmen und wird zusammen mit den übrigen Änderungen gespeichert. Auch leere Tabs bleiben nach dem Speichern erhalten. Noch nicht gespeicherte Tabs und Verschiebungen lassen sich rückgängig machen.
- **Bilder hinzufügen:** JPEG, PNG, WebP, AVIF, HEIC/HEIF oder JPEG XL auswählen. Die Originaldatei wird unverändert an den lokalen Server übergeben. ImageIO/Core Image richtet sie aus, skaliert auf maximal 2400 px und verarbeitet Farbe und HDR nativ. Keine Cloud, kein Browser-Canvas. RAW bitte zuvor exportieren.
- **Dateien hineinziehen:** Bilddateien aus dem Finder auf eine beliebige Stelle im Editor ziehen. Sie werden wie bei „Bilder hinzufügen“ vorbereitet und zur ausgewählten Galerie hinzugefügt. Datei-Upload und das Ziehen vorhandener Bilder zum Sortieren sind unabhängig. Ordner werden nicht unterstützt.
- **Ausblenden / Einblenden:** Ein ausgeblendetes Bild bleibt in der Liste und auf der Festplatte, wird aber vom öffentlichen Galerie-Renderer weggelassen. Im Editor ist es abgedunkelt und markiert.
- **Entfernen:** Merkt das Bild zum Entfernen vor. Erst beim Speichern wird es aus der Galerie genommen und seine Datei in den Projekt-Papierkorb verschoben. Es erfolgt kein endgültiges Löschen.
- **Rückgängig:** Nimmt noch nicht gespeicherte Änderungen zurück, einschließlich Uploads, Ausblenden und Entfernen. Nach erfolgreichem Speichern beginnt eine neue Änderungshistorie.
- **Änderungen speichern:** Sichert zuerst die bestehende Bilderliste sowie zu entfernende Dateien und prüft die Kopien. Übernimmt danach die Änderungen. Gleichnamige Uploads erhalten eindeutige Dateinamen und überschreiben keine vorhandenen Fotos.
- **Bilddarstellung:** „Automatisch“ verwendet auf HDR-fähigen Displays die HDR-Variante. „SDR-Vorschau“ erzwingt die tatsächlich gespeicherte SDR-Datei, auch auf einem HDR-Monitor.
- **Eigene SDR-Version:** Bei HDR-Fotos kann ein selbst abgestimmter SDR-Export mit demselben Ausschnitt gewählt werden. Die Software konvertiert dessen Farbprofil nach sRGB und berechnet die Gain Map neu. Dadurch liegt auch der HDR-JPEG-Datei die eigene SDR-Darstellung zugrunde. Die bisherige Variante wird erst beim Speichern ersetzt und vollständig gesichert.
- **Nur Bilder:** Zeigt die Galerie ohne Bedienelemente und ohne ausgeblendete Bilder. Die Breitenvorschau zeigt Desktop, Laptop und Handy.

Uploads werden in die beim Auswählen aktive Galerie eingefügt. Obergrenzen: 60 MB je Original, 20 MB je vorbereitetem Bild, ungefähr 50 MB vorbereitete Bilder pro Speichervorgang. Bei größeren Mengen in mehreren Durchgängen speichern.

Zum Beenden im Terminal Ctrl+C drücken. Änderungen bleiben lokal. Die lokale Startseite liest die Bilderliste und zeigt die sichtbaren Fotos direkt unter dem Cover. Erst eine ausdrücklich veranlasste Veröffentlichung aktualisiert die Live-Website.

## Dateien und Wiederherstellung

- `gallery-data.js`: Bilderliste, Reihenfolge, Beschreibungen, Abmessungen und optional `hidden: true`. Bei HDR-Bildern verweist `src` auf die sRGB-SDR-Fassung und `hdrSrc` auf die HDR-JPEG-Datei mit Gain Map. `hdrHeadroom` und `sdrMethod` dokumentieren die Verarbeitung.
- `media/images/events/` und `media/images/portraits/`: Galeriefotos, einschließlich gespeicherter Uploads.
- Neue Tabs erhalten bei ihrem ersten Upload einen eigenen Ordner unter `media/images/`. Seine Bezeichnung wird aus dem Tab-Namen abgeleitet. Beim späteren Verschieben zwischen Tabs bleiben Dateipfade stabil; die aktuelle Galeriezuordnung steht ausschließlich in `gallery-data.js`.
- `Papierkorb/gallery-edit-…/gallery-data.js`: vorherige Bilderliste.
- `Papierkorb/gallery-edit-…/removed/media/images/…`: entfernte Bilder mit ursprünglicher Ordnerstruktur.

Zum Wiederherstellen einer Entfernung die gewünschte Bilddatei aus `removed/` an ihren ursprünglichen Ort kopieren und den entsprechenden Eintrag aus der gesicherten Bilderliste wieder übernehmen. Eine ganze Bilderliste nur wiederherstellen, wenn auch die darin genannten Dateien vorhanden sind. Vorher den Editor beenden und den aktuellen Stand sichern.

HDR- und SDR-Dateien bilden eine Einheit: Beim Verschieben bleiben beide erhalten; beim Entfernen werden beide im Papierkorb gesichert. Beim Wiederherstellen immer beide Varianten berücksichtigen.

Der Server ist ausschließlich auf diesem Computer erreichbar. Er stellt nur Editor-Dateien und Galerie-Bilder bereit. Kein Hosting, keine Cloud, keine zusätzlichen Python-Pakete. Benötigt werden Python 3.9 oder neuer, ein aktueller Browser und die auf diesem Mac vorhandenen Apple-Entwicklerwerkzeuge. Der native Swift-Helfer wird bei der ersten Bildaufbereitung in einem temporären Cache kompiliert; der erste Upload kann deshalb länger dauern. Die Verarbeitung ist für die vorhandene macOS-26-Umgebung geprüft. Compiler und Bildbibliotheken kommen von Apple.

## Einbindung in die öffentliche Website

Die Startseite lädt `gallery-data.js` vor `script.js`. Ihr Container mit `data-gallery-feed` zeigt alle sichtbaren Bilder in der Reihenfolge der Galerien und der jeweiligen Bilderlisten. Neue Editor-Tabs werden automatisch berücksichtigt. Ausgeblendete Bilder werden weggelassen.

Für separate Galeriebereiche können alternativ diese Container verwendet werden:

```html
<div class="photo-grid photo-grid-events" data-gallery="events"></div>
<div class="photo-grid" data-gallery="portraits"></div>
```

`data-show-hidden` gehört ausschließlich an die Editor-Container. Der Website-Renderer in `script.js` lässt ausgeblendete Bilder standardmäßig weg. Die Website zeigt lückenlose Bildreihen mit gleicher Bildhöhe und variabler Breite. Alle Bilder bleiben vollständig sichtbar und behalten ihre Reihenfolge. Bis 780 px stehen höchstens zwei, bis 1100 px drei, darüber maximal vier Bilder nebeneinander. Der Editor verwendet zum Sortieren weiterhin einzelne Bildkarten mit derselben Obergrenze für die Spalten.

Dateisicherheitsprüfungen: `python3 tools/gallery-editor/test_server.py`. Diese Tests arbeiten ausschließlich in temporären Ordnern.

## HDR und natürliche SDR-Darstellung

- Bei Bildern mit Gain Map nutzt die SDR-Ausgabe die im Original hinterlegte SDR-Darstellung. Diese erhält die beabsichtigte Belichtung und die Farbgestaltung des Exports.
- Bei reinem HDR ohne solche Darstellung übernimmt ImageIO die native HDR-zu-SDR-Tonwertumrechnung. Es wird kein zusätzlicher pauschaler Kontrast-, Sättigungs- oder Belichtungsfilter angewendet.
- Alle SDR-Ausgaben werden mit eingebettetem sRGB-Profil geschrieben. Ein Display-P3-SDR-Foto bleibt SDR; ein großer Farbraum allein wird nicht als HDR gewertet.
- Die HDR-Ausgabe ist ein JPEG mit Gain Map, berechnet aus dem HDR-Look und der verwendeten SDR-Fassung. Der Python-Adapter ergänzt browserkompatible Adobe-Ultra-HDR-Metadaten und den MPF-Index ohne erneute Bildkompression. Damit gibt es auch für Decoder ohne HDR dieselbe SDR-Basis. Die Ausgabe wird nochmals als HDR dekodiert und geprüft.
- Die Galerie verwendet `<picture>` mit einer HDR-Quelle für `(dynamic-range: high)` und der expliziten SDR-Datei als Standardbild. Das gilt auch für die Großansicht. Die tatsächliche HDR-Helligkeit hängt vom Display und Browser ab.
- Automatische Umrechnung kann die individuelle Bildgestaltung nicht für jedes Motiv erraten. Wenn die eingebettete SDR-Fassung bereits unpassend ist oder eine andere Gestaltung gewünscht wird, „Eigene SDR-Version“ verwenden und in der SDR-Vorschau prüfen.
- Bereits durch den alten Canvas-Upload abgeflachte Bilder bekommen keine verlorenen HDR-Details zurück. Dafür das HDR-Original erneut hochladen. Bestehende Dateien werden nicht ungefragt neu konvertiert.

Native Farb-/HDR-Tests: `python3 tools/gallery-editor/test_image_processing.py`. Diese erzeugen ausschließlich synthetische Referenzbilder in temporären Ordnern.

Über der Startseitengalerie filtert ein kleiner Schalter nach All, Events oder Portraits. Jeder neue Seitenaufruf startet mit All; die im Editor festgelegte Reihenfolge bleibt innerhalb der Auswahl erhalten.
