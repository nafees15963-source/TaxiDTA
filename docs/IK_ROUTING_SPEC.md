# IK-Routing: Nachweis und noch offene Umsetzung

Stand: 22.10.2026. In der lokalen Demo ist **kein produktives IK-Routing aktiv**. Es gibt keine Kassennamen-Heuristik, Defaultadresse oder manuelle Live-Freigabe. Der DTA-Prüflauf liefert einen gesperrten Bereitschaftsbericht; das ist weder§ 302-Nutzdatei noch Versandnachweis.

## Amtliche, tatsächlich gelesene Grundlage

[Anhang 3 V09,07.10.2026](https://www.gkv-datenaustausch.de/media/dokumente/leistungserbringer_1/sonstige_leistungserbringer/technische_anlagen_aktuell_4/20261007_TP5_TA1_Anhang3_V009.pdf), anwendbar 01.06.2026, Abschnitte 5 und 8.3: VKG 01 verbindet Karten-IK und Kostenträger; 02 bezeichnet nicht entschlüsselungsbefugte Datenannahme,03 die entschlüsselungsbefugte Stelle,09 die Papierannahme. Lieferart 07/30 ist zu berücksichtigen. Schlüsselwahl folgt der berechtigten Entschlüsselungsstelle, auch bei vorgeschaltetem Netzbetreiber. Region, Leistungsbereich, AC/TK und Medium dürfen nicht verloren gehen. Ein begrenzter KOTR-Leser für diese Datensatzstruktur ist inzwischen implementiert (`src/domain/ik.ts`). Er löst keinen Routinggraphen auf und erteilt keine fachliche Freigabe. Unterstützungsgrenzen: `KE_PARSER_PROFILE.md`.

## Beabsichtigter geprüfter Datenpfad

```text
Original-Karten-IK
  → datierterVKG01-Link → tatsächlicherKostenträger
  → leistungs-/regionsbezogeneVKG-Auswahl
      → physischerTransportadressat (ggf.VKG02)
      → EntschlüsselungsadressatVKG03 → verifiziertesZertifikat
  → separaterVKG09-Link / aktuelleoffiziellePapierquelle
```

Der spätere Importer muss Originalbytes, URL, Abrufzeit, Hash, Fassung und Anwendungszeitraum sichern. Aktivierung benötigt syntaktische/semantische Validierung, Konfliktprüfung und kontrollierte Freigabe. Routing Decision friert die verwendeten Datensätze und Zertifikats-/Endpunktbelege ein. Eine Quelle mit höherer Versionszahl gilt nicht automatisch früher. V10 ist ab 01.02.2027 vorgesehen.

## Harte Sperren

Unbekannte oder mehrdeutige IK, fehlender Leistungsbereich, unaufgelöster VKG-Pfad, fehlenderberechtigter Entschlüsseler, abgelaufenes/gesperrtes/falschzugeordnetes Zertifikat, fehlende Transportvereinbarung, fehlende Software-/Teilnehmerfreigabe, unklarer Papierempfänger und widersprüchliche Primärquellen blockieren immer. Keine Post-/Mailadresse aus der historischen Beispielrechnung wird als Fallback eingesetzt.

R11/R12 zeigen, weshalb diese Prüfung nötig ist: AOK-Zuständigkeit hängt von Leistungsgruppen ab; eine aktuelle ITSCare-Seite enthält für einenlogischen Empfänger zwei unterschiedliche Angaben. Das wird als Quellkonflikt behandelt, nicht über eine bevorzugte Tabellenzelle entschieden.

## Noch notwendige Negativtests vor Livefähigkeit

1. Gleicher Kassenname mitverschiedenen IK darf keine Zuordnung erzeugen.
2. Weiterleiterohne Entschlüsselungsrecht darf niemals seineneigenen Schlüssel als Zielschlüssel erzwingen.
3. VKG-Zyklus, Dubletten, abgelaufene Links, falsches Medium undüberlappende Gültigkeiten blockieren.
4. Zertifikatswechsel verändert keinehistorischen Einreichungsnachweise.
5. Importvorschau zeigt betroffenegeplante Sendungen; keine stille Aktivierung.

Diese Tests sind Anforderungen, solange vollständiger aktivierbarer KE-Import, Routingauflösung und Krypto-/Transportadapter fehlen. Die bereits implementierteglobale Versandsperre ist ein kleinerer Nachweis und darf nicht als Konformität dieser Routingpipeline ausgegeben werden.
