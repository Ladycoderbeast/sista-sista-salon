(function () {
  const FALLBACK_GROUPS = [
    { category:"Natural Hair", items:[
      "Shampoo & Conrow","Detangling Shampoo Blowout","Natural Ponytail Hair No Silk Press","Silk Press",
      "Conditioning Treatment","Dandruff Treatment","Olapex Breakage Treatment","K18 Treatment",
      "Wig sew in(closure)","Wig sew in(frontal)","Wig revamp(shampooing+curling)","Wig revamp(shampooing+straight)",
      "Wig install ( frontal) sticking","Relax cut & style( pixie)","Shampoo & style (short hair)","Wig straightening or curling of weaves"
    ]},
    { category:"Relaxed Hair", items:[
      "Shampoo+Blow Drying+Straightening","Shampoo+roller setting","Shampoo & Conrows",
      "Relaxer+blowdrying+straightening(salon cream)one","Relaxer+Rollerset one & half(salon cream)",
      "Relaxer+blowdrying+straightening one & half","Relaxer two (salon cream)","Relaxer+blowouts one & half(salon cream)",
      "Relaxer+roller setting(personal cream)","Relaxer+blowdrying+straightening(personal cream)",
      "Own relaxer without shampoo & conditioner","Extra","Trimming","Cutting","Other Con-rows",
      "Conditioning treatment","Dandruff treatment","Olaplex Breakage treatment","K18 Treatment","Traditional sew in",
      "Closure sew in","Tracks glue","Tracks sew in","Relaxed hair ponytail","Relaxer front & back"
    ]},
    { category:"Nails", items:[
      "Pedicure & No polish","Pedicure + Regular polish","Pedicure + Gel polish","Pedicure + Acrylic on toes","Pedicure + stick on",
      "Pedicure stick on + French","Extra for French tips","Jelly Pedicure & Gel polish","Pedicure men","Manicure",
      "Regular Polish","Basic Gel polish","BIAB / Structured Gel polish","Hard Gel + Gel polish","Acrylic Full nails",
      "Acrylic nails on toes","Acrylic on toes refill","Acrylic refill (did full set with us)","Acrylic refill ( did not do full set with us)",
      "Stick on/ Gel polish","Dissolving","Dissolving + Manicure"
    ]},
    { category:"Waxing", items:[
      "Eyebrow Wax","Chin Wax","Chest Wax","Eyebrow shaping","Upper lip","Under arm","Stomach","Full arm","Half arm",
      "Half Legs","Full leg","Bikini area","Full Face","Hollywood wax"
    ]},
    { category:"Spa", items:[
      "Hot stone massage 1hr","Hot stone massage 1hr 30mins","Deep tissue massage 30mins","Deep tissue massage 1hr",
      "Deep tissue massage 1hr 30mins","Swedish massage 30mins","Swedish massage 1hr","Swedish massage 1hr 30mins",
      "Body Scrub","Steam Therapy","Back Treatment","Facials Deep cleanse","Facials Deep cleanse (upgrade)",
      "Facials Rejuvenation","Facials Anti acne","Facials Dermplane (Extra)"
    ]}
  ];
  window.loadCheckinServices = async function (host) {
    let names = await SalonVisits.serviceNames();
    if (!names.length) names = FALLBACK_GROUPS.flatMap(g => g.items);
    host.replaceChildren();
    for (const name of [...new Set(['Help me choose', ...names])]) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.value = name; input.name = 'services';
      label.append(input, document.createTextNode(name));
      host.appendChild(label);
    }
  };
})();
