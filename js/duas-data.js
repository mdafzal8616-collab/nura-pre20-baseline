// Dua content data. Every entry below was cross-checked against a named,
// citable hadith reference before being added here — see docs/decisions.md
// for the verification pass. Categories with no entries yet are left
// genuinely empty (structure ready) rather than filled with unverified
// text. Do not add a dua here without a real citation.

(function () {
  "use strict";

  var DUA_CATEGORIES = [
    { id: "morning", name: "Morning" },
    { id: "evening", name: "Evening" },
    { id: "sleep", name: "Sleep" },
    { id: "waking-up", name: "Waking Up" },
    { id: "salah", name: "Salah" },
    { id: "protection", name: "Protection" },
    { id: "stress-anxiety", name: "Stress / Anxiety" },
    { id: "forgiveness", name: "Forgiveness" },
    { id: "travel", name: "Travel" },
    { id: "food", name: "Food" },
    { id: "daily-life", name: "Daily Life" }
  ];

  var DUAS = [
    {
      id: "waking-up-1",
      categoryId: "waking-up",
      title: "Upon Waking Up",
      arabic: "الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ",
      transliteration: "Alhamdu lillahil-ladhi ahyana ba'da ma amatana wa ilayhin-nushur",
      meaning: "All praise is for Allah who gave us life after having taken it from us, and to Him is the resurrection.",
      source: "Sahih al-Bukhari; compiled in Hisnul Muslim, “Du’as for Waking Up”"
    },
    {
      id: "sleep-1",
      categoryId: "sleep",
      title: "Before Sleeping",
      arabic: "بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا",
      transliteration: "Bismika Allahumma amutu wa ahya",
      meaning: "In Your name, O Allah, I die and I live.",
      source: "Sahih al-Bukhari; compiled in Hisnul Muslim, “Du’as Before Sleeping”"
    },
    {
      id: "forgiveness-1",
      categoryId: "forgiveness",
      title: "Sayyidul Istighfar — the master supplication for forgiveness",
      arabic: "اللَّهُمَّ أَنْتَ رَبِّي، لاَ إِلَهَ إِلاَّ أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَىَّ وَأَبُوءُ لَكَ بِذَنْبِي، فَاغْفِرْ لِي، فَإِنَّهُ لاَ يَغْفِرُ الذُّنُوبَ إِلاَّ أَنْتَ",
      transliteration: "Allahumma anta Rabbi, la ilaha illa anta, khalaqtani wa ana 'abduka, wa ana 'ala 'ahdika wa wa'dika mastata'tu, a'udhu bika min sharri ma sana'tu, abu'u laka bini'matika 'alayya, wa abu'u laka bidhanbi, faghfir li fa innahu la yaghfirudh-dhunuba illa anta",
      meaning: "O Allah, You are my Lord; there is no god but You. You created me and I am Your servant, and I am faithful to my covenant and promise as much as I am able. I seek refuge in You from the evil of what I have done. I acknowledge Your favor upon me, and I acknowledge my sin — so forgive me, for none forgives sins except You.",
      source: "Sahih al-Bukhari 6306, narrated by Shaddad ibn Aws"
    },
    {
      id: "stress-anxiety-1",
      categoryId: "stress-anxiety",
      title: "For Anxiety and Sorrow",
      arabic: "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ، وَالْعَجْزِ وَالْكَسَلِ، وَالْبُخْلِ وَالْجُبْنِ، وَضَلَعِ الدَّيْنِ وَغَلَبَةِ الرِّجَالِ",
      transliteration: "Allahumma inni a'udhu bika minal-hammi wal-hazani, wal-'ajzi wal-kasali, wal-bukhli wal-jubni, wa dala'id-daini wa ghalabatir-rijal",
      meaning: "O Allah, I seek refuge in You from anxiety and sorrow, weakness and laziness, miserliness and cowardice, the burden of debts and from being overpowered by others.",
      source: "Sahih al-Bukhari 6369, narrated by Anas ibn Malik"
    },
    {
      id: "food-1",
      categoryId: "food",
      title: "Before Eating",
      arabic: "بِسْمِ اللَّهِ",
      transliteration: "Bismillah",
      meaning: "In the name of Allah.",
      source: "Sunan Abi Dawud 3767; Jami' at-Tirmidhi 1858"
    },
    {
      id: "food-2",
      categoryId: "food",
      title: "After Eating",
      arabic: "الْحَمْدُ لِلَّهِ الَّذِي أَطْعَمَنَا وَسَقَانَا وَجَعَلَنَا مُسْلِمِينَ",
      transliteration: "Alhamdu lillahil-ladhi at'amana wa saqana wa ja'alana Muslimeen",
      meaning: "All praise is for Allah, who fed us, gave us drink, and made us Muslims.",
      source: "Sunan Abi Dawud 3850; Jami' at-Tirmidhi 3457"
    },
    {
      id: "morning-1",
      categoryId: "morning",
      title: "Morning Declaration",
      arabic: "أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ",
      transliteration: "Asbahna wa asbahal mulku lillah, wal-hamdu lillah, la ilaha illallahu wahdahu la sharika lah, lahul-mulku wa lahul-hamd, wa huwa 'ala kulli shay'in qadir",
      meaning: "We have entered the morning, and with it all dominion belongs to Allah, and praise is for Allah. There is no god but Allah, alone, without partner. His is the dominion and His is the praise, and He is capable of all things.",
      source: "Sahih Muslim 2723"
    },
    {
      id: "evening-1",
      categoryId: "evening",
      title: "Evening Declaration",
      arabic: "أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ",
      transliteration: "Amsayna wa amsal mulku lillah, wal-hamdu lillah, la ilaha illallahu wahdahu la sharika lah, lahul-mulku wa lahul-hamd, wa huwa 'ala kulli shay'in qadir",
      meaning: "We have entered the evening, and with it all dominion belongs to Allah, and praise is for Allah. There is no god but Allah, alone, without partner. His is the dominion and His is the praise, and He is capable of all things.",
      source: "Sahih Muslim 2723 (evening form — recited with 'Amsayna' in place of 'Asbahna')"
    },
    {
      id: "salah-1",
      categoryId: "salah",
      title: "After Hearing the Adhan",
      arabic: "اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ، وَالصَّلَاةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ، وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ، إِنَّكَ لَا تُخْلِفُ الْمِيعَادَ",
      transliteration: "Allahumma Rabba hadhihid-da'watit-tammati was-salatil-qa'imah, ati Muhammadanil-wasilata wal-fadilah, wab'athhu maqaman mahmudan-alladhi wa'adtah, innaka la tukhliful-mi'ad",
      meaning: "O Allah, Lord of this perfect call and the prayer about to be established, grant Muhammad the intercession and favor, and raise him to the praised station You have promised him. You do not break Your promise.",
      source: "Sahih al-Bukhari 614, narrated by Jabir ibn ‘Abdullah"
    },
    {
      id: "protection-1",
      categoryId: "protection",
      title: "Seeking Refuge from Harm",
      arabic: "أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ",
      transliteration: "A'udhu bikalimatillahi at-tammati min sharri ma khalaq",
      meaning: "I seek refuge in the perfect words of Allah from the evil of what He has created.",
      source: "Sahih Muslim 2708a, narrated by Khawlah bint Hakim"
    },
    {
      id: "travel-1",
      categoryId: "travel",
      title: "Setting Out on a Journey",
      arabic: "سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ وَإِنَّا إِلَى رَبِّنَا لَمُنْقَلِبُونَ",
      transliteration: "Subhanal-ladhi sakhkhara lana hadha wa ma kunna lahu muqrinin, wa inna ila rabbina lamunqalibun",
      meaning: "Glory be to Him who has made this subject to us, and we could never have done it by ourselves. And indeed, to our Lord we will return.",
      source: "Sahih Muslim 1342, narrated by Ibn ‘Umar (echoing Qur’an 43:13–14)"
    },
    {
      id: "daily-life-1",
      categoryId: "daily-life",
      title: "Leaving Home",
      arabic: "بِسْمِ اللَّهِ تَوَكَّلْتُ عَلَى اللَّهِ وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ",
      transliteration: "Bismillahi tawakkaltu 'alallahi wa la hawla wa la quwwata illa billah",
      meaning: "In the name of Allah, I place my trust in Allah, and there is no power or strength except with Allah.",
      source: "Sunan Abi Dawud 5095, Jami' at-Tirmidhi 3426 (graded hasan by at-Tirmidhi), narrated by Anas ibn Malik"
    },
    {
      id: "stress-anxiety-2",
      categoryId: "stress-anxiety",
      title: "In Times of Distress",
      arabic: "لَا إِلَهَ إِلَّا اللَّهُ الْعَظِيمُ الْحَلِيمُ، لَا إِلَهَ إِلَّا اللَّهُ رَبُّ الْعَرْشِ الْعَظِيمِ، لَا إِلَهَ إِلَّا اللَّهُ رَبُّ السَّمَاوَاتِ وَرَبُّ الْأَرْضِ وَرَبُّ الْعَرْشِ الْكَرِيمِ",
      transliteration: "La ilaha illallahul-'Azimul-Halim, la ilaha illallahu Rabbul-'Arshil-'Azim, la ilaha illallahu Rabbus-samawati wa Rabbul-ardi wa Rabbul-'Arshil-Karim",
      meaning: "There is no god but Allah, the Mighty, the Forbearing. There is no god but Allah, Lord of the Mighty Throne. There is no god but Allah, Lord of the heavens, Lord of the earth, and Lord of the Noble Throne.",
      source: "Sahih al-Bukhari and Sahih Muslim, narrated by Ibn ‘Abbas"
    },
    {
      id: "daily-life-2",
      categoryId: "daily-life",
      title: "Entering the Bathroom",
      arabic: "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْخُبُثِ وَالْخَبَائِثِ",
      transliteration: "Allahumma inni a'udhu bika minal-khubthi wal-khaba'ith",
      meaning: "O Allah, I seek refuge in You from male and female unclean spirits.",
      source: "Sahih al-Bukhari 142, Sahih Muslim 375"
    },
    {
      id: "daily-life-3",
      categoryId: "daily-life",
      title: "Leaving the Bathroom",
      arabic: "غُفْرَانَكَ",
      transliteration: "Ghufranak",
      meaning: "I ask You (Allah) for forgiveness.",
      source: "Sunan Abi Dawud 30, narrated by ‘A’ishah, authenticated by at-Tirmidhi"
    },
    {
      id: "daily-life-4",
      categoryId: "daily-life",
      title: "Wearing New Clothes",
      arabic: "اللَّهُمَّ لَكَ الْحَمْدُ أَنْتَ كَسَوْتَنِيهِ، أَسْأَلُكَ مِنْ خَيْرِهِ وَخَيْرِ مَا صُنِعَ لَهُ، وَأَعُوذُ بِكَ مِنْ شَرِّهِ وَشَرِّ مَا صُنِعَ لَهُ",
      transliteration: "Allahumma lakal-hamdu anta kasawtanihi, as'aluka khayrahu wa khayra ma suni'a lah, wa a'udhu bika min sharrihi wa sharri ma suni'a lah",
      meaning: "O Allah, to You belongs all praise. You have clothed me with this. I ask You for its goodness and the goodness of what it was made for, and I seek refuge in You from its evil and the evil of what it was made for.",
      source: "Sunan Abi Dawud, Jami’ at-Tirmidhi (graded hasan by at-Tirmidhi), An-Nasa’i"
    },
    {
      id: "daily-life-5",
      categoryId: "daily-life",
      title: "Entering Home",
      arabic: "بِسْمِ اللَّهِ وَلَجْنَا، وَبِسْمِ اللَّهِ خَرَجْنَا، وَعَلَى اللَّهِ رَبِّنَا تَوَكَّلْنَا",
      transliteration: "Bismillahi walajna, wa bismillahi kharajna, wa 'alallahi Rabbina tawakkalna",
      meaning: "In the name of Allah we enter, and in the name of Allah we leave, and upon Allah our Lord we place our trust.",
      source: "Sunan Abi Dawud, Book 43, Hadith 5096"
    },
    {
      id: "daily-life-6",
      categoryId: "daily-life",
      title: "Calming Anger",
      arabic: "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ",
      transliteration: "A'udhu billahi minash-shaytanir-rajim",
      meaning: "I seek refuge in Allah from Satan, the accursed.",
      source: "Sahih al-Bukhari and Sahih Muslim (agreed upon)"
    },
    {
      id: "daily-life-7",
      categoryId: "daily-life",
      title: "Sneezing and Replying",
      arabic: "(الْعَاطِسُ) الْحَمْدُ لِلَّهِ — (الْمُجِيبُ) يَرْحَمُكَ اللَّهُ — (الْعَاطِسُ) يَهْدِيكُمُ اللَّهُ وَيُصْلِحُ بَالَكُمْ",
      transliteration: "(Sneezer) Alhamdulillah — (Listener replies) Yarhamukallah — (Sneezer replies) Yahdikumullahu wa yuslihu balakum",
      meaning: "The one who sneezes says “Praise be to Allah.” Whoever hears it replies “May Allah have mercy on you.” The sneezer then replies “May Allah guide you and set your affairs right.”",
      source: "Sahih al-Bukhari, Book of Good Manners (Al-Adab)"
    },
    {
      id: "daily-life-8",
      categoryId: "daily-life",
      title: "Seeing Something Pleasing",
      arabic: "الْحَمْدُ لِلَّهِ الَّذِي بِنِعْمَتِهِ تَتِمُّ الصَّالِحَاتُ",
      transliteration: "Alhamdulillahil-ladhi bini'matihi tatimmus-salihat",
      meaning: "Praise is for Allah, by Whose grace good things are completed.",
      source: "Sunan Ibn Majah; compiled in Hisn al-Muslim 218"
    }
  ];

  window.NURA_DUAS = { categories: DUA_CATEGORIES, duas: DUAS };
})();
