// Supabase Edge Function : stripe-webhook
// Reçoit l'événement "checkout.session.completed" de Stripe
// et envoie un email de confirmation personnalisé via Resend.
//
// Déploiement (voir README-EMAIL.md) :
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Secrets à configurer (supabase secrets set ...) :
//   STRIPE_WEBHOOK_SECRET  → fourni par Stripe à la création du webhook (whsec_...)
//   RESEND_API_KEY         → clé API Resend (re_...)
//   SENDER_EMAIL           → expéditeur. Pour la démo : "onboarding@resend.dev"
//                            En prod : une adresse de votre domaine vérifié,
//                            ex. "contact@udr-rhone69.fr"
//   SENDER_NAME            → ex. "UDR du Rhône"
//   NOTIF_EMAIL            → adresse interne qui reçoit chaque inscription
//                            (jamais visible des inscrits). En test : votre
//                            propre adresse ; en prod : celle de Sophie.

import Stripe from "npm:stripe@17";

const stripe = new Stripe("sk_placeholder_non_utilise", {
  apiVersion: "2024-06-20",
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  // 1) Vérifier que l'appel vient bien de Stripe (signature)
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.error("Signature invalide :", err);
    return new Response("Signature invalide", { status: 400 });
  }

  // 2) Ne traiter que les paiements finalisés
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_details?.email;
    const nom = session.customer_details?.name ?? "";
    const tel = session.customer_details?.phone ?? "non renseigné";
    const adr = session.customer_details?.address;
    const adresse = adr
      ? [adr.line1, adr.line2, [adr.postal_code, adr.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
      : "non renseignée";
    const montant = ((session.amount_total ?? 0) / 100).toFixed(2).replace(".", ",");

    if (email) {
      // 3) Envoi de l'email via Resend
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        },
        body: JSON.stringify({
          from: `${Deno.env.get("SENDER_NAME") ?? "UDR du Rhône"} <${Deno.env.get("SENDER_EMAIL")}>`,
          to: [email],
          subject: "Inscription confirmée — Réunion de rentrée UDR du Rhône",
          html: `
            <div>
              <!-- Police du site (chargée par Apple Mail ; Gmail/Outlook utiliseront Arial Narrow) -->
              <style>
                @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;600&display=swap');
              </style>
            <div style="font-family:'Barlow',Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1A2233">
              <div style="background:#0B1F4B;color:#fff;padding:18px 24px;border-radius:10px 10px 0 0;border-bottom:4px solid #E1000F">
                <div style="font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-weight:800;font-size:24px;letter-spacing:.5px;text-transform:uppercase">UDR du Rhône</div>
                <div style="font-size:12px;opacity:.8;letter-spacing:1px;text-transform:uppercase">Union des Droites pour la République</div>
              </div>
              <div style="border:1px solid #D9DEE9;border-top:none;padding:24px;border-radius:0 0 10px 10px">
                <h2 style="font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-weight:800;font-size:26px;letter-spacing:.5px;text-transform:uppercase;color:#0B1F4B;margin-top:0">Participation prise en compte ✓</h2>
                <p>Bonjour ${nom || ""},</p>
                <p>Merci ! Votre inscription à la <strong>réunion de rentrée politique de
                l'UDR du Rhône</strong> est bien confirmée.</p>
                <table style="width:100%;font-size:14px;border-collapse:collapse;margin:16px 0">
                  <tr><td style="padding:6px 0;color:#5A6478">Date</td><td style="padding:6px 0"><strong>Samedi 3 octobre 2026</strong></td></tr>
                  <tr><td style="padding:6px 0;color:#5A6478">Horaire</td><td style="padding:6px 0"><strong>19h00</strong> — réunion suivie d'un apéritif dînatoire</td></tr>
                  <tr><td style="padding:6px 0;color:#5A6478">Lieu</td><td style="padding:6px 0">agglomération lyonnaise — adresse exacte communiquée par email quelques jours avant l'événement</td></tr>
                  <tr><td style="padding:6px 0;color:#5A6478">Participation</td><td style="padding:6px 0"><strong>${montant} €</strong></td></tr>
                </table>
                <p>Votre présence est importante. Ensemble, poursuivons la dynamique
                de notre mouvement&nbsp;!</p>
                <p style="color:#5A6478;font-size:13px;margin-top:20px">
                  Bien fidèlement,<br>
                  <strong style="color:#0B1F4B">Alexandre Dupalais</strong><br>
                  Délégué départemental de l'UDR du Rhône
                </p>
              </div>
            </div>
            </div>`,
        }),
      });

      if (!res.ok) {
        console.error("Erreur Resend :", await res.text());
        // On répond quand même 200 à Stripe : le paiement est valide,
        // seul l'email a échoué (visible dans les logs Supabase).
      }

      // 4) Notification interne (adresse jamais visible des inscrits)
      const notif = Deno.env.get("NOTIF_EMAIL");
      if (notif) {
        const res2 = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
          },
          body: JSON.stringify({
            from: `${Deno.env.get("SENDER_NAME") ?? "UDR du Rhône"} <${Deno.env.get("SENDER_EMAIL")}>`,
            to: [notif],
            subject: `Nouvelle inscription : ${nom} (${montant} €)`,
            html: `
              <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1A2233">
                <h2 style="color:#0B1F4B">Nouvelle inscription — Réunion de rentrée</h2>
                <table style="width:100%;font-size:14px;border-collapse:collapse">
                  <tr><td style="padding:5px 0;color:#5A6478;width:130px">Nom</td><td style="padding:5px 0"><strong>${nom}</strong></td></tr>
                  <tr><td style="padding:5px 0;color:#5A6478">Email</td><td style="padding:5px 0">${email}</td></tr>
                  <tr><td style="padding:5px 0;color:#5A6478">Téléphone</td><td style="padding:5px 0">${tel}</td></tr>
                  <tr><td style="padding:5px 0;color:#5A6478">Adresse</td><td style="padding:5px 0">${adresse}</td></tr>
                  <tr><td style="padding:5px 0;color:#5A6478">Montant</td><td style="padding:5px 0"><strong>${montant} €</strong></td></tr>
                </table>
                <p style="color:#5A6478;font-size:12px;margin-top:14px">Email automatique — liste complète exportable depuis le dashboard Stripe (Paiements → Export).</p>
              </div>`,
          }),
        });
        if (!res2.ok) console.error("Erreur notification :", await res2.text());
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
