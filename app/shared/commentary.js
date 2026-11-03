/* Live commentary line bank (from Lab 2.6): two commentators, a friendly tier (base) and a sharper tier (spicy).
   Lines use placeholders: {u} {to} {a} {b} {n} {total} {suit} {loss} {title} {item}. Names are filled in on each phone from nicknames,
   so the text always shows the right names. Recorded clips, when present at /audio/commentary/<id>.mp3, play for the same ID.
   IDs look like  bablu.base.cut.2  or  chacha.spicy.donkey.0  and stay stable: add new lines to the END of a list, never reorder. */
const COMM = {
  bablu: { name: 'Bablu Bhaiya', icon: '🎙️', pitch: 1.12, rate: 1.04,
    base: {
      hand: ['Naya haath, naya kismat. Sab log dhyaan se!', 'Patta baant gail, ab dekhal jaai kekar bhaagya chamki!', 'Chalo ho, naya round! Gadha ke kursi khaali ba.'],
      cut: ['Ka ho {to}! {u} ta {total} patta thama dihlas, ab sambhaal!', 'Arre baap re! {u} ke cut, {to} ke ghar mein patta ke barsaat!', '{u} bolal: le {to}, prasad samajh ke rakh la!', 'Ee ka bhail? {to} ke haath mein {total} naya mehmaan!', '{u} garda uda dihlas! {to} ke chehra ekdum utar gail.', 'Dekha dekha, {u} {n} {suit} fenkas, {to} bechara utha raha ba.'],
      bigcut: ['Hai dada! {total} patta! {to} ke ta poora godown khul gail!', 'Ee cut na, bhookamp ha! {to} ab patta ke pahaad pe baithal ba.', '{u} ta aaj kasam kha ke aail ba, {to} ke barbaad karke chhodi!'],
      clean: ['Sab log line mein, {u} ke chaal sabse bhaari. Ab {u} chali.', 'Shanti ba abhi... toofan se pehle wala shanti.', '{u} ke patta sabse ooncha, raja jaisan chaal!', 'Koi cut na, koi drama na. Bhaiya, masala kab aai?'],
      out: ['{u} nikal gail! Ghar jaa ke chai piyi, baaki log jhelo.', 'Wah {u}! Haath khaali, dil khush. Bach gail aaj.', '{u} ta bhaag gail jaise bijli ke bill dekh ke log bhaagela!', '{u} safe! Ab aaram se baith ke tamasha dekha.'],
      showdown: ['Ab bachal ba khaali do: {a} aur {b}! Dil thaam ke baitha sab!', 'Final muqabla! {a} ki {b}, ke banee aaj ke gadha?', 'Dhadkan tez! {a} aur {b}, ek ke ta gadha banhi ke ba!'],
      donkey: ['Hee-haw! {u} ban gail gadha! Loss number {loss}.', 'Ka ho {u}, phir se? Ee ta aadat ban gail ba!', '{u} ke haath mein patta bachal, aur sir pe gadha ke taaj!', 'Badhai ho {u}! Gadha parivaar mein swagat ba.'],
      danger: ['{u} ab ek kadam door ba Donkey of the Day se! Bhagwan bachaave!', 'Khatra! {u} ke ek aur loss, aur certificate pakka!'],
      auto: ['{u} so gail ka? Time khatam, chaal apne aap chal gail!', 'Ae {u}, jaag ja! Ghadi kehu khatir na ruke.'],
      crown: ['{u} {to} ke naya naam dihlas: {title}. Ab yahi chali!', 'Naya naam mubarak ho {to}: {title}!'],
      award: ['Aaj ke Donkey of the Day: {u}! Taali bajaa sab log!', 'Itihaas ban gail! {u} aaj ke sabse bada gadha! Hee-haw!', 'Certificate taiyaar ba {u}, frame karwa ke deewar pe taang dihla!'],
      throw: ['{u} {to} pe {item} fenk dihlas! Nishana ekdum sateek!', 'Ae {to}, bacha ho! {item} aa raha ba!', 'Ee ka, {u} ke gussa {item} ban ke uda!']
    },
    spicy: {
      hand: ['Kursi pe gadha likhal ba, dekhal jaai ke baithi!'],
      cut: ['{to}, tohar kismat ta gobar mein gir gail!', '{u} ke dimaag tez, {to} ke dimaag ghaas chare gail ba!'],
      out: ['{u} bhaag gail, darpok kahin ke!'],
      showdown: ['{a} aur {b}, dono ke chehra pe gadha likhal ba, dekhal jaai kekar pakka hoi!'],
      donkey: ['{u} ke ta janam hi gadha banne khatir bhail rahe!', 'Ghar pe batana mat {u}, izzat ke sawaal ba!'],
      danger: ['{u} ke ta ab bhagwan hi bachaihen!'],
      auto: ['{u} se tez ta sarkari daftar chalela!'],
      award: ['{u}, aaj ghar jaa ke aaina mat dekhiha, gadha dikhi!']
    } },
  chacha: { name: 'Commentator Chacha', icon: '🏏', pitch: .92, rate: 1.0,
    base: {
      hand: ['Naya haath shuru! Fielders apni position pe.', 'Toss ho gaya, ab khel shuru. Best of luck sabko!', 'Naya over, naye patte. Dekhte hain aaj kiska din hai.'],
      cut: ['Aur yeh raha cut! {u} ne {to} ko {total} patte thama diye!', 'Kya shot hai! {n} {suit} seedha {to} ki jholi mein!', '{to} ke liye mushkil over chal raha hai. {total} patte aur aa gaye!', 'Commentary box mein sannata... {u} ne kamaal kar diya!', '{u} ka yorker, {to} clean bowled! Pickup {total}.'],
      bigcut: ['Unbelievable! {total} patte! {to} ki toh dukaan khul gayi!', 'Yeh cut nahi, stadium ke bahar sixer hai! {to} hil gaye!'],
      clean: ['Sab ne suit follow kiya. Dot ball. {u} lead karenge.', 'Shaant over chal raha hai, {u} ka patta sabse bhaari.', 'Koi cut nahi... tension badh rahi hai, dosto.'],
      out: ['{u} pavilion laut gaye, safe aur muskurate hue!', 'Shaandaar innings {u}! Haath khaali, kaam khatam.', '{u} ke patte khatam, matlab bach gaye. Baaki log ab dhyan se.'],
      showdown: ['Last over, last two: {a} vs {b}! Saans roko!', 'Yeh hai asli final! {a} aur {b}, ek ko gadha banna hi padega.'],
      donkey: ['Aur gaya! {u} bane is haath ke Donkey. Loss number {loss}.', '{u} crease pe atke reh gaye. Hee-haw!', 'Scoreboard pe ek aur loss {u} ke naam.'],
      danger: ['{u} ab sirf ek loss door hain Donkey of the Day se. Pressure!'],
      auto: ['{u} ka time out! Third umpire ne chaal chal di.', 'Arre {u}, timer ne aapko run out kar diya!'],
      crown: ['{u} ne {to} ko khitaab diya: {title}!', 'Scoreboard pe naya naam: {to} urf {title}!'],
      award: ['Match khatam! Aaj ke Donkey of the Day: {u}!', 'Player of the Match nahi, Donkey of the Day: {u}! Trophy mein gadha!', 'Kya match tha! Lekin aaj ki trophy {u} ke naam, hee-haw!'],
      throw: ['{u} ki taraf se {to} ko {item} ka bouncer!', '{item} seedha {to} ke helmet pe! Kya delivery!']
    },
    spicy: {
      hand: ['Aaj kisi na kisi ki izzat ka match hai!'],
      cut: ['{to}, aapki batting dekh ke gully cricket wale bhi has rahe hain!'],
      out: ['{u} bhaag gaye, jaise bill aate hi dost bhaagte hain!'],
      donkey: ['{u}, aapko toh selector bhi gadha team mein pehli pick lenge!'],
      danger: ['{u}, abhi bhi time hai, phone switch off karke bhaag lo!'],
      auto: ['{u} ki speed dekh ke Test match bhi T20 lagta hai!'],
      award: ['{u}, aapka naam ab gadha hall of fame mein amar ho gaya!']
    } }
};
const THROWS = [{ e: '🍅', l: 'Tomato', n: 'tamatar', hit: 'splat' }, { e: '🩴', l: 'Chappal', n: 'chappal', hit: 'thwack' }, { e: '🥚', l: 'Egg', n: 'anda', hit: 'splat' }, { e: '🌹', l: 'Rose', n: 'gulaab', hit: 'ding' }, { e: '🫏', l: 'Hee-haw', n: 'gadha', hit: 'heehaw' }];
const HITFX = { tamatar: '<i class="blob"></i><b>Splat!</b>', chappal: '<b>Thapp!</b>', anda: '<i class="blob egg"></i><b>Crack!</b>', gulaab: '<b>💖</b>', gadha: '<b>Hee-haw!</b>' };
const BOT_HIT = {
  tamatar: ['Arre! Tamatar ₹80 kilo hai, waste mat kar 😤', 'Sabzi mandi bana diya table ko 🍅'],
  chappal: ['Chappal? Mummy ki yaad aa gayi 😭', 'Yeh personal ho gaya 🩴'],
  anda: ['Anda? Omelette bana lunga 🍳', 'Protein ke liye thanks 💪'],
  gulaab: ['Aww, gulaab! Phir bhi cut maarunga 🌹', 'Itna pyaar? Kuch toh gadbad hai 🤨'],
  gadha: ['Gadha main nahi, tu hai 🫏', 'Hee-haw khud ko bol 😏']
};
const COMM_KINDS = ["hand", "cut", "bigcut", "clean", "out", "showdown", "donkey", "danger", "auto", "crown", "award", "throw"];
/* flat list [{ id, who, tier, kind, text }] used by tests and by the recording script */
const COMM_LINES = (() => { const out = []; for (const who of Object.keys(COMM)) for (const tier of ["base", "spicy"]) for (const kind of Object.keys(COMM[who][tier])) COMM[who][tier][kind].forEach((text, i) => out.push({ id: who + "." + tier + "." + kind + "." + i, who, tier, kind, text })); return out; })();
const commLine = id => COMM_LINES.find(l => l.id === id) || null;
