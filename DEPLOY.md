# Going live: checklist

Replace example.com with your domain everywhere (sitemap.xml, robots.txt, deploy/nginx.conf, deploy/env.example, .well-known/security.txt).
Before deploying, set config.js to window.API_URL = "/api".

## 1. Business and legal
- Trade licence and a UAE business bank account.
- VAT: if turnover is above the registration threshold, register for VAT and show your Tax Registration Number (TRN) on receipts. Standard rate is 5%.
- Have a lawyer review legal.html against UAE data protection law (PDPL) and consumer rules.
- Confirm the cookie position. The site sets only essential session cookies, so no consent banner is required for them. Add one if you add analytics or ads.
- Note the Stripe and SMS sender approvals. Both can take days to weeks.

## 2. Domain and email
- Register the domain. Point www to the server.
- Send email from your domain: add SPF, DKIM and DMARC DNS records so codes are not marked as spam.

## 3. Server
- Ubuntu 22.04 or 24.04 LTS, in a region close to your customers.
- Create a non-root user for the app (vg). Use SSH keys only; disable password login.
- Firewall: allow ports 22, 80 and 443 only. Install fail2ban and unattended-upgrades.
- Install Node.js 20 LTS, nginx and certbot.

## 4. Install the app
  sudo mkdir -p /opt/verde-gold && sudo chown vg:vg /opt/verde-gold
  copy backend/ to /opt/verde-gold/backend
  cd /opt/verde-gold/backend && npm install --omit=dev
  sudo cp deploy/env.example /etc/verde-gold.env && sudo chmod 600 /etc/verde-gold.env   (then edit the values)
  sudo cp deploy/vg-api.service /etc/systemd/system/ && sudo systemctl enable --now vg-api
  sudo mkdir -p /var/www/verde-gold && copy the site files there (not the backend folder)
  sudo cp deploy/nginx.conf /etc/nginx/sites-available/verde-gold && sudo ln -s /etc/nginx/sites-available/verde-gold /etc/nginx/sites-enabled/
  sudo certbot --nginx -d example.com -d www.example.com
  sudo nginx -t && sudo systemctl reload nginx

The server refuses to start in production if JWT_SECRET is shorter than 32 characters or ADMIN_PASSWORD is still the default.

## 5. Payments
- Create a Stripe account. Test with test keys first, then switch to live keys.
- Add a webhook endpoint at https://www.example.com/api/webhooks/stripe for the event checkout.session.completed.
- Copy the webhook signing secret into STRIPE_WEBHOOK_SECRET.

## 6. Backups
- Test the backup: cd /opt/verde-gold/backend && npm run backup
- Install the daily job: sudo crontab -u vg deploy/crontab.txt
- Copy backend/data/backups off the server every day (to cloud storage or another machine).
- Test a restore at least once: stop the service, replace app.db with a backup copy, start the service, and check the content.

## 7. Monitoring
- Set up a free uptime check on https://www.example.com/api/health and alert by email or SMS.
- Watch the service logs: journalctl -u vg-api -f
- Check disk space and renew certificates (certbot renews automatically; check it with sudo certbot renew --dry-run).

## 8. Search and listings
- Add the site to Google Search Console and submit sitemap.xml.
- Create a Google Business Profile with the address, hours, photos and menu link.
- Check the site on mobile with Google PageSpeed Insights.

## 9. Final testing (before public launch)
- Sign up with a real email and a real phone number. Check codes arrive, and check that a wrong code fails after 5 tries.
- Log in with 2FA on. Reset a password.
- Place a pay-on-arrival order and a Stripe test-card order. Confirm the webhook marks it paid and points are added.
- Opt in on the leaderboard and check the name appears.
- Make a reservation, then confirm and cancel it in the admin.
- Change a price, the hours and a photo in the admin, and check the changes show on the site.
- Test on a phone, a tablet and a laptop. Check the Arabic/English switch if you add translations.
- Run Lighthouse in Chrome DevTools. Aim for 90+ on accessibility and best practices.

## 10. Ongoing
- Change the admin password every few months, and give each staff member their own login when you add that feature.
- Run npm audit regularly and update packages.
- Keep the Node.js version on a supported LTS release.
- Review the orders and reservations daily.
