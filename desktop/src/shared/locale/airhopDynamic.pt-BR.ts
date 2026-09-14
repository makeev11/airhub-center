// biome-ignore-all lint/suspicious/noAssignInExpressions: sequential regex matching keeps each localized template next to its captures
/**
 * Localizes legacy UI sentences assembled with runtime values.
 *
 * Captured values are user or application data and are never translated.
 */
export function translateAirHopDynamicPtBr(text: string): string | undefined {
  let match: RegExpMatchArray | null;

  if (
    (match = text.match(
      /^(\d+) entr(?:y is|ies are) not 64-char hex and will be ignored\.$/,
    ))
  ) {
    const count = Number(match[1]);
    return `${match[1]} ${count === 1 ? "entrada não é" : "entradas não são"} um valor hexadecimal de 64 caracteres e ${count === 1 ? "será ignorada" : "serão ignoradas"}.`;
  }
  if ((match = text.match(/^(\d+) valid pubkeys? ready\.$/))) {
    return `${match[1]} ${Number(match[1]) === 1 ? "chave pública válida pronta" : "chaves públicas válidas prontas"}.`;
  }
  if ((match = text.match(/^Scale: 0–(.+)$/))) return `Escala: 0–${match[1]}`;
  if ((match = text.match(/^Period (.+) — (.+)$/)))
    return `Período ${match[1]} — ${match[2]}`;
  if (
    (match = text.match(
      /^(Today is partial|Complete calendar days)\. A visitor represents a browser\.$/,
    ))
  ) {
    return `${match[1] === "Today is partial" ? "O dia de hoje está incompleto" : "Dias completos do calendário"}. Cada visitante representa um navegador.`;
  }
  if ((match = text.match(/^Pending: (.+) · Cancelled: (.+)$/))) {
    return `Pendentes: ${match[1]} · Cancelados: ${match[2]}`;
  }
  if (
    (match = text.match(
      /^Without browser attribution: (.+) of (.+) bookings\. A booking channel may be known without a specific acquisition origin\.$/,
    ))
  ) {
    return `Sem atribuição do navegador: ${match[1]} de ${match[2]} agendamentos. O canal do agendamento pode ser conhecido sem uma origem de aquisição específica.`;
  }
  if ((match = text.match(/^(.+) lessons exceed capacity\.$/))) {
    return `${match[1]} aulas excedem a capacidade.`;
  }
  if ((match = text.match(/^Sort (.+): (.+)$/)))
    return `Ordenar ${match[1]}: ${match[2]}`;
  if ((match = text.match(/^Create (.+) $/))) return `Criar ${match[1]} `;
  if ((match = text.match(/^Create a new (.+)$/))) return `Criar ${match[1]}`;
  if ((match = text.match(/^New (.+)$/))) return `Novo: ${match[1]}`;
  if (
    (match = text.match(
      /^Delete (.+) from the Center\. This action cannot be undone\.$/,
    ))
  ) {
    return `Excluir ${match[1]} do Center. Esta ação não pode ser desfeita.`;
  }
  if ((match = text.match(/^Edit (private|public) channel$/))) {
    return `Editar canal ${match[1] === "private" ? "privado" : "público"}`;
  }
  if ((match = text.match(/^View channel members \((.+)\)$/))) {
    return `Ver participantes do canal (${match[1]})`;
  }
  if ((match = text.match(/^Choose who can send instructions to (.+)\.$/))) {
    return `Escolha quem pode enviar instruções para ${match[1]}.`;
  }
  if ((match = text.match(/^Actions for (.+)$/)))
    return `Ações para ${match[1]}`;
  if ((match = text.match(/^Open profile for (.+)$/)))
    return `Abrir perfil de ${match[1]}`;
  if ((match = text.match(/^Remove (.+)\?$/))) return `Remover ${match[1]}?`;
  if ((match = text.match(/^Added (:.+:)$/))) return `${match[1]} adicionado`;
  if ((match = text.match(/^Removed (:.+:)$/))) return `${match[1]} removido`;
  if (
    (match = text.match(
      /^You already have (:.+:) — saving will replace its image\.$/,
    ))
  ) {
    return `Você já tem ${match[1]} — salvar substituirá a imagem.`;
  }
  if ((match = text.match(/^Remove (:.+:)$/))) return `Remover ${match[1]}`;
  if ((match = text.match(/^DM from (.+)$/)))
    return `Conversa direta de ${match[1]}`;
  if ((match = text.match(/^Thread with (.+)$/)))
    return `Conversa com ${match[1]}`;
  if ((match = text.match(/^Thread in #(.+)$/)))
    return `Conversa em #${match[1]}`;
  if ((match = text.match(/^DM with (.+)$/)))
    return `Conversa direta com ${match[1]}`;
  if ((match = text.match(/^Message in #(.+)$/)))
    return `Mensagem em #${match[1]}`;
  if ((match = text.match(/^Message (\d+) people$/)))
    return `Enviar mensagem para ${match[1]} pessoas`;
  if ((match = text.match(/^Message (.+)$/)))
    return `Mensagem para ${match[1]}`;
  if ((match = text.match(/^Send reply to (.+)$/)))
    return `Enviar resposta para ${match[1]}`;
  if ((match = text.match(/^(\d+) due reminders?$/))) {
    return `${match[1]} ${Number(match[1]) === 1 ? "lembrete vencido" : "lembretes vencidos"}`;
  }
  if ((match = text.match(/^(\d+) active drafts?$/))) {
    return `${match[1]} ${Number(match[1]) === 1 ? "rascunho ativo" : "rascunhos ativos"}`;
  }
  if ((match = text.match(/^Reminder in (\d+)([mhd])$/))) {
    return `Lembrete em ${match[1]}${match[2]}`;
  }
  if ((match = text.match(/^Open inbox item from (.+)$/))) {
    return `Abrir item da caixa de entrada de ${match[1]}`;
  }
  if ((match = text.match(/^In DM with (.+)$/)))
    return `Em conversa direta com ${match[1]}`;
  if ((match = text.match(/^(\d+) attachments?$/))) {
    return `${match[1]} ${Number(match[1]) === 1 ? "anexo" : "anexos"}`;
  }
  if (
    (match = text.match(
      /^Are you sure you want to send this message to (.+)\?$/,
    ))
  ) {
    return `Tem certeza de que deseja enviar esta mensagem para ${match[1]}?`;
  }
  if ((match = text.match(/^View draft in (.+)$/)))
    return `Ver rascunho em ${match[1]}`;
  if ((match = text.match(/^(\d+) people$/))) return `${match[1]} pessoas`;
  if ((match = text.match(/^(.+), and ([^,]+)$/)))
    return `${match[1]} e ${match[2]}`;
  if ((match = text.match(/^Use (.+) backdrop$/)))
    return `Usar plano de fundo ${match[1]}`;
  if ((match = text.match(/^Use (.+) background$/)))
    return `Usar fundo ${match[1]}`;
  if ((match = text.match(/^Capture (.+) sec video$/)))
    return `Gravar vídeo de ${match[1]} s`;
  if ((match = text.match(/^Only (.+) \(owner\)$/)))
    return `Somente ${match[1]} (proprietário)`;
  if ((match = text.match(/^Open #(.+)$/))) return `Abrir #${match[1]}`;
  if ((match = text.match(/^(Unfollow|Follow) failed: (.+)$/))) {
    return `Não foi possível ${match[1] === "Unfollow" ? "deixar de seguir" : "seguir"}: ${match[2]}`;
  }
  if ((match = text.match(/^(\d+)([mhd]) overdue$/)))
    return `${match[1]}${match[2]} em atraso`;
  if ((match = text.match(/^in (\d+)([mhd])$/)))
    return `em ${match[1]}${match[2]}`;
  if ((match = text.match(/^(\d+)([mhd]) ago$/)))
    return `há ${match[1]}${match[2]}`;
  if ((match = text.match(/^(Thread|Message) in$/))) {
    return `${match[1] === "Thread" ? "Conversa" : "Mensagem"} em`;
  }
  if (
    (match = text.match(
      /^v(.+) available — download from GitHub\. Switch to AppImage for automatic updates\.$/,
    ))
  ) {
    return `v${match[1]} disponível — baixe do GitHub. Use o AppImage para receber atualizações automáticas.`;
  }
  if ((match = text.match(/^Pairing stopped: (.+)$/)))
    return `Pareamento interrompido: ${match[1]}`;
  if ((match = text.match(/^Update available — v(.+)$/)))
    return `Atualização disponível — v${match[1]}`;
  if ((match = text.match(/^Update failed: (.+)$/)))
    return `Falha na atualização: ${match[1]}`;
  if ((match = text.match(/^Pause (.+)$/))) return `Pausar ${match[1]}`;
  if ((match = text.match(/^Preview (.+)$/))) return `Ouvir ${match[1]}`;
  if ((match = text.match(/^Open thread from (.+)$/)))
    return `Abrir conversa de ${match[1]}`;
  if ((match = text.match(/^(\d+) channels$/))) return `${match[1]} canais`;
  if ((match = text.match(/^Delete section "(.+)"\? It has no channels\.$/))) {
    return `Excluir a seção “${match[1]}”? Ela não contém canais.`;
  }
  if (
    (match = text.match(
      /^Delete section "(.+)"\? Its (.+) will move back to the default Channels group\.$/,
    ))
  ) {
    return `Excluir a seção “${match[1]}”? ${match[2]} voltarão ao grupo padrão Canais.`;
  }
  if (
    (match = text.match(
      /^Leave "(.+)"\? You'll stop receiving its messages and can rejoin later\.$/,
    ))
  ) {
    return `Sair de “${match[1]}”? Você deixará de receber as mensagens e poderá entrar novamente depois.`;
  }
  if ((match = text.match(/^What this (.+) is for$/)))
    return `Para que serve ${match[1]}`;
  if ((match = text.match(/^More actions for (.+)$/)))
    return `Mais ações para ${match[1]}`;
  if (text.match(/^No .+s match your search$/))
    return "Nenhum resultado corresponde à sua busca";
  if (text.match(/^No archived .+s$/)) return "Nenhum item arquivado";
  if (text.match(/^No joined .+s$/)) return "Você ainda não entrou em nenhum";
  if (text.match(/^No .+s to browse$/)) return "Nenhum item disponível";
  if (
    (match = text.match(
      /^No (.+) by that name yet — create it to get started\.$/,
    ))
  ) {
    return `Ainda não existe ${ptBrChannelEntity(match[1])} com esse nome — crie para começar.`;
  }
  if (text.match(/^Archived .+s you have joined will appear here\.$/))
    return "Os itens arquivados dos quais você participa aparecerão aqui.";
  if (text.match(/^.+s you join will appear here\.$/))
    return "Os itens dos quais você participar aparecerão aqui.";
  if (
    (match = text.match(
      /^All open (.+)s are available in the sidebar\. Create a new .+ to get started\.$/,
    ))
  ) {
    const entity = ptBrChannelEntity(match[1]);
    return `Todos os itens abertos estão disponíveis na barra lateral. Crie ${entity} para começar.`;
  }

  return undefined;
}

function ptBrChannelEntity(value: string): string {
  return /^f[oó]rum/i.test(value) ? "um fórum" : "um canal";
}
