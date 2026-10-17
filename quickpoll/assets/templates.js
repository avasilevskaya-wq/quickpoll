/* QuickPoll — starter templates, written in the builder's text format (see Text tab). */
window.QP_TEMPLATES = [
  {
    name: 'Design feedback',
    desc: 'Pick a direction and rate the mockups',
    text: [
      '# Design feedback',
      '> We prepared a few directions. Just tap what feels right — about a minute.',
      '',
      'Which direction do you prefer? [comment]',
      '- Option A',
      '- Option B',
      '- Option C',
      '',
      'How well does it fit your brand? [1-5: Not at all | Perfectly]',
      '',
      'Which colour mood is closer to what you want?',
      '- Calm and light',
      '- Bold and contrasting',
      '- Dark and premium',
      '',
      'Can we move on with the chosen direction? [yes/no, comment]'
    ].join('\n')
  },
  {
    name: 'Feature priorities',
    desc: 'What should we build first?',
    text: [
      '# What should we build next?',
      '',
      'Which features matter most right now? [multi]',
      '? Pick up to three',
      '- Reports and export',
      '- Notifications',
      '- Mobile version',
      '- Integrations',
      '- User roles',
      '',
      'What is the single most important one?',
      '- Reports and export',
      '- Notifications',
      '- Mobile version',
      '- Integrations',
      '- User roles',
      '',
      'How urgent is it? [1-5: Can wait | Needed yesterday]',
      '',
      'Anything we missed? [text]'
    ].join('\n')
  },
  {
    name: 'Demo feedback',
    desc: 'Quick check after a sprint demo',
    text: [
      '# Sprint demo feedback',
      '[ask name]',
      '',
      'Overall, how happy are you with what you saw? [1-5: Not happy | Very happy]',
      '',
      'Does it work the way you expected? [yes/no, comment]',
      '',
      'What should we focus on next?',
      '- Polish what we have',
      '- Build the next feature',
      '- Fix the issues we discussed',
      '',
      'Anything else? [text]'
    ].join('\n')
  },
  {
    name: 'Quick approval',
    desc: 'One yes/no with an optional comment',
    text: [
      '# Approval',
      '',
      'Do you approve this version? [yes/no, comment]'
    ].join('\n')
  },
  {
    name: 'Meeting time',
    desc: 'Choose a slot for the next call',
    text: [
      '# When can we meet?',
      '[ask name]',
      '',
      'Which slots work for you? [multi]',
      '- Mon 10:00',
      '- Mon 15:00',
      '- Tue 11:00',
      '- Wed 16:00',
      '',
      'Preferred format',
      '- Video call',
      '- Phone',
      '- In person'
    ].join('\n')
  }
];
