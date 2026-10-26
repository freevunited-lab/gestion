# Mesurer le scanner de tickets

La suite actuelle utilise des transcriptions synthétiques. Elle vérifie les règles de lecture, pas la précision de l'OCR sur des photos réelles.

Pour mesurer la précision, préparez avec consentement un fichier JSON local (hors du dépôt) contenant des transcriptions OCR et les valeurs corrigées :

```json
[
  {
    "name": "ticket-001",
    "text": "MAGASIN\nDATE 25/10/2026 12:40\nTOTAL TTC 12,30 €",
    "expected": { "merchant": "Magasin", "amount": "12,30", "date": "2026-10-25", "time": "12:40" }
  }
]
```

Une valeur absente attendue se note `null`. Exécutez `node scripts/evaluate-receipts.mjs chemin/vers/tickets-annotes.json`. Le rapport sépare les champs corrects, manquants et erronés ; `unsafeHighConfidence` compte les erreurs pourtant affichées comme fiables. Une valeur non nulle fait échouer la commande.

Pour évaluer l'ensemble du scan, conservez aussi les photos et le résultat OCR brut, puis comparez plusieurs téléphones et conditions de lumière. Ce script ne lit que le texte OCR : il ne mesure ni la détection du ticket, ni la qualité de la photo, ni la vitesse de l'OCR.

Le scanner redresse uniquement les tickets dont les bords sur fond sombre sont suffisamment nets. Il garde le cadrage classique dans les autres cas. Les corrections de nom de magasin sont enregistrées localement, séparément par compte et utilisateur, après sauvegarde d'une opération ; deux corrections identiques sont nécessaires avant de proposer le nom corrigé. Effacer les données locales sensibles ou supprimer le compte efface cet apprentissage.
