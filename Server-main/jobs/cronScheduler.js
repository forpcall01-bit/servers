const db = require('../db');

function initCronScheduler() {
  setInterval(async () => {
    try {
      const users = await db.filter('users', u => 
        u.status === 'active' && 
        u.expiry_date && 
        Date.now() > u.expiry_date
      );
      
      for (const user of users) {
        await db.update('users', u => u.id === user.id, { status: 'expired' });
        console.log(`[AUTO-EXPIRE] User ${user.username} expired`);
      }
      
      if (users.length > 0) {
        console.log(`[AUTO-EXPIRE] ${users.length} accounts expired`);
      }
    } catch(e) {
      console.error('[AUTO-EXPIRE] Error:', e);
    }
  }, 86400000); // 24 hours
}

module.exports = {
  initCronScheduler
};
