import axios from 'axios';
import { META_GRAPH_API_VERSION } from '../lib/meta-graph-version';

const TOKEN = 'EAAcKFnFDeBgBQnQee6fjt46OYijR8fahJO9yAUbchGN4V87OWPlBYhx0jmRXYWcmWAnyZCCsD9DNURJx9sq9MmvrboTKGS1b3rn5oRgHVgyED1hAynyZCNQspkCZAffabWLnfWfou2JvSOI7AFFm0tFfvt2wpbHv6MPmZBN6zZC1NQron4BpYbce4lIB8NrcrFZBF8HgfZAaTMraFh14CPwjfpLQVBFvZBU0UFTAsgn5KZBa9F0pPywvyli5dN3q6eSXbGO9Gw3jqvIn6uprq8BhKm6Ol2yhLzPjJ8wZDZD';

async function verify() {
  console.log('🔍 Iniciando verificação de credenciais...');

  try {
    // 1. Identificar o usuário
    console.log('\n1️⃣  Identificando dono do Token...');
    const me = await axios.get(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/me`, {
      params: { access_token: TOKEN, fields: 'id,name' }
    });
    console.log(`✅ Token Válido! Usuário: ${me.data.name} (ID: ${me.data.id})`);

    // 2. Listar Contas de Anúncios
    console.log('\n2️⃣  Buscando Contas de Anúncios...');
    const adAccounts = await axios.get(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/adaccounts`, {
      params: {
        access_token: TOKEN,
        fields: 'name,account_id,currency,account_status',
        limit: 10
      }
    });

    const accounts = adAccounts.data.data;
    if (accounts.length === 0) {
      console.log('⚠️  Nenhuma conta de anúncios encontrada para este usuário.');
      return;
    }

    console.log(`✅ Encontradas ${accounts.length} contas de anúncio:`);
    accounts.forEach((acc: any) => {
      console.log(`   - NOME: ${acc.name} | ID: ${acc.account_id} | MOEDA: ${acc.currency}`);
    });

    // 3. Testar Insights da primeira conta encontrada
    const firstAccount = accounts[0];
    const adAccountId = `act_${firstAccount.account_id}`;
    console.log(`\n3️⃣  Testando extração de dados da conta: ${firstAccount.name} (${adAccountId})...`);
    
    try {
      const insights = await axios.get(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adAccountId}/insights`, {
        params: {
          access_token: TOKEN,
          level: 'campaign',
          date_preset: 'maximum',
          limit: 1
        }
      });

      if (insights.data.data.length > 0) {
        console.log('✅ SUCESSO! Dados encontrados:', insights.data.data[0]);
      } else {
        console.log('✅ Conexão OK, mas nenhum dado de campanha recente encontrado nesta conta.');
      }
    } catch (err: any) {
      console.error('❌ Falha ao ler insights:', err.response?.data?.error?.message || err.message);
    }

  } catch (error: any) {
    console.error('\n❌ Erro Crítico:', error.response?.data || error.message);
  }
}

verify();
