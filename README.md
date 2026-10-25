# Verde & Gold café: website files

## Pages
- index.html: Home (text from the content file)
- menu.html: Menu (from the content file)
- checkout.html: Order checkout with card or pay on arrival
- visit.html: Reservations, hours and FAQ
- gallery.html: Photos (from the content file)
- account.html: Customer account. Log in, see orders and loyalty points, turn on 2FA
- leaderboard.html: Loyalty leaderboard (opted-in customers only)
- story.html, legal.html, 404.html: other pages (text from the content file)
- manage-9kq2x7.html: Secret admin. Not linked from the site. Keep this address private.

## Set the API address
Edit config.js and set window.API_URL to your live API address. All pages read it from there.

## Back end (backend/)
See backend/README.md. Summary:
  cd backend && npm install
  JWT_SECRET=... ADMIN_PASSWORD=... NODE_ENV=production npm start
Add the Stripe keys to enable card payments. Without them, customers can pay on arrival.

## Before going live
1. Build email and SMS sending for verification and reset codes. Customers cannot sign up in production until this is done.
2. Set a strong ADMIN_PASSWORD and a long JWT_SECRET, and use HTTPS.
3. Replace placeholder details (name, address, phone, WhatsApp, hours, prices, photos) in the admin.
4. Review the privacy and terms text with a lawyer.
5. Back up data/app.db daily (npm run backup) and keep copies off the server.
