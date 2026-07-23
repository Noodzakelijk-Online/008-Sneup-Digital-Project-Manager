// Import only the NLP primitives Sneup uses. Requiring natural's root module
// eagerly loads every analyser, classifier, language pack, and WordNet helper.
const { WordTokenizer } = require('natural/lib/natural/tokenizers/regexp_tokenizer');
const SentenceTokenizer = require('natural/lib/natural/tokenizers/sentence_tokenizer');
const TfIdf = require('natural/lib/natural/tfidf/tfidf');
const SentimentAnalyzer = require('natural/lib/natural/sentiment/SentimentAnalyzer');
const PorterStemmer = require('natural/lib/natural/stemmers/porter_stemmer');
const logger = require('../utils/logger');
const Card = require('../models/Card');
const Comment = require('../models/Comment');
const Member = require('../models/Member');
const { getDefaultWorkspaceObjectId, normalizeWorkspaceObjectId } = require('./workspaceScopeService');

// Initialize NLP components
const tokenizer = new WordTokenizer();
const sentenceTokenizer = new SentenceTokenizer();
const analyzer = new SentimentAnalyzer('English', PorterStemmer, 'afinn');

/**
 * Natural Language Processing Service
 * Provides NLP capabilities for analyzing Trello content
 */

// Analyze card content
const analyzeCardContent = async (cardId, options = {}) => {
  try {
    logger.info(`Analyzing content for card: ${cardId}`);
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    
    // Get card with comments
    const card = await Card.findOne({ _id: cardId, workspaceId })
      .populate({
        path: 'comments',
        populate: { path: 'memberId' }
      });
    
    if (!card) {
      logger.warn(`Card not found: ${cardId}`);
      return null;
    }
    
    // Combine text from card and comments
    let fullText = `${card.name} ${card.description}`;
    const commentTexts = card.comments.map(c => c.text || '');
    fullText += ' ' + commentTexts.join(' ');
    
    // Perform analyses
    const keywords = extractKeywords(fullText);
    const sentiment = analyzeSentiment(fullText);
    const entities = extractEntities(fullText);
    const actionItems = extractActionItems(commentTexts);
    
    // Analyze individual comments
    const commentAnalyses = [];
    for (const comment of card.comments) {
      if (comment.text) {
        const commentSentiment = analyzeSentiment(comment.text);
        const isAction = detectActionItem(comment.text);
        
        // Update comment with analysis
        comment.sentiment = commentSentiment;
        comment.isActionItem = isAction;
        comment.entities = extractEntities(comment.text);
        await comment.save();
        
        commentAnalyses.push({
          commentId: comment._id,
          memberId: comment.memberId ? comment.memberId._id : null,
          sentiment: commentSentiment,
          isActionItem: isAction
        });
      }
    }
    
    return {
      cardId: card._id,
      cardName: card.name,
      keywords,
      sentiment,
      entities,
      actionItems,
      commentAnalyses
    };
  } catch (error) {
    logger.error(`Failed to analyze card content ${cardId}:`, error);
    return null;
  }
};

// Extract keywords using TF-IDF
const extractKeywords = (text) => {
  try {
    const tfidf = new TfIdf();
    tfidf.addDocument(text);
    
    const keywords = [];
    tfidf.listTerms(0).slice(0, 10).forEach(item => {
      keywords.push({
        term: item.term,
        score: item.tfidf
      });
    });
    
    return keywords;
  } catch (error) {
    logger.error('Failed to extract keywords:', error);
    return [];
  }
};

// Analyze sentiment
const analyzeSentiment = (text) => {
  try {
    const sentences = sentenceTokenizer.tokenize(text);
    
    let totalScore = 0;
    const sentimentBySegment = [];
    
    for (const sentence of sentences) {
      const tokens = tokenizer.tokenize(sentence);
      const score = analyzer.getSentiment(tokens);
      
      totalScore += score;
      sentimentBySegment.push({
        text: sentence,
        score,
        classification: classifySentiment(score)
      });
    }
    
    const averageScore = sentences.length > 0 ? totalScore / sentences.length : 0;
    
    return {
      score: averageScore,
      classification: classifySentiment(averageScore),
      bySegment: sentimentBySegment
    };
  } catch (error) {
    logger.error('Failed to analyze sentiment:', error);
    return {
      score: 0,
      classification: 'neutral',
      bySegment: []
    };
  }
};

// Classify sentiment score
const classifySentiment = (score) => {
  if (score <= -0.5) return 'very_negative';
  if (score < 0) return 'negative';
  if (score === 0) return 'neutral';
  if (score <= 0.5) return 'positive';
  return 'very_positive';
};

// Extract entities from text
const extractEntities = (text) => {
  try {
    const entities = {
      people: [],
      dates: [],
      skills: [],
      roles: []
    };
    
    // Extract @ mentions
    const mentions = text.match(/@(\w+)/g) || [];
    entities.people = mentions.map(m => m.substring(1));
    
    // Extract dates
    const datePatterns = [
      /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
      /\d{1,2}-\d{1,2}-\d{2,4}/g,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(?:st|nd|rd|th)?,? \d{4}\b/g,
      /\b(?:tomorrow|next week|next month|today|yesterday)\b/gi,
      /\bin \d+ days?\b/gi,
      /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi
    ];
    
    for (const pattern of datePatterns) {
      const matches = text.match(pattern) || [];
      entities.dates.push(...matches);
    }
    
    // Extract skills
    const skillsList = [
      'javascript', 'python', 'java', 'react', 'node', 'angular', 'vue',
      'aws', 'azure', 'docker', 'kubernetes', 'sql', 'mongodb',
      'design', 'ui', 'ux', 'testing', 'qa', 'devops'
    ];
    
    const textLower = text.toLowerCase();
    for (const skill of skillsList) {
      if (textLower.includes(skill)) {
        entities.skills.push(skill);
      }
    }
    
    // Extract roles
    const rolesList = [
      'developer', 'engineer', 'designer', 'manager', 'director',
      'frontend', 'backend', 'fullstack', 'devops', 'qa'
    ];
    
    for (const role of rolesList) {
      if (textLower.includes(role)) {
        entities.roles.push(role);
      }
    }
    
    return entities;
  } catch (error) {
    logger.error('Failed to extract entities:', error);
    return { people: [], dates: [], skills: [], roles: [] };
  }
};

// Extract action items from comments
const extractActionItems = (commentTexts) => {
  try {
    const actionItems = [];
    
    for (let i = 0; i < commentTexts.length; i++) {
      const text = commentTexts[i];
      
      if (detectActionItem(text)) {
        actionItems.push({
          text,
          commentIndex: i
        });
      }
    }
    
    return actionItems;
  } catch (error) {
    logger.error('Failed to extract action items:', error);
    return [];
  }
};

// Detect if text contains an action item
const detectActionItem = (text) => {
  const actionPhrases = [
    'please', 'pls', 'can you', 'could you', 'would you',
    'need to', 'needs to', 'should', 'must', 'have to',
    'todo', 'to-do', 'to do', 'action item', 'follow up'
  ];
  
  const textLower = text.toLowerCase();
  
  // Check for action phrases
  for (const phrase of actionPhrases) {
    if (textLower.includes(phrase)) {
      return true;
    }
  }
  
  // Check for imperative verbs
  const sentences = sentenceTokenizer.tokenize(text);
  for (const sentence of sentences) {
    const words = tokenizer.tokenize(sentence);
    if (words.length > 0) {
      const firstWord = words[0].toLowerCase();
      const imperativeVerbs = [
        'add', 'check', 'create', 'do', 'fix', 'get', 'implement',
        'make', 'prepare', 'review', 'send', 'update', 'verify'
      ];
      
      if (imperativeVerbs.includes(firstWord)) {
        return true;
      }
    }
  }
  
  return false;
};

// Analyze communication patterns
const analyzeCommunicationPatterns = async (options = {}) => {
  try {
    logger.info('Analyzing communication patterns');
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    
    // Get all comments with populated references
    const comments = await Comment.find({ workspaceId })
      .populate('memberId')
      .populate('cardId');
    
    // Build communication graph
    const communicationGraph = {};
    
    for (const comment of comments) {
      if (!comment.memberId || !comment.text) continue;
      
      const commenterId = comment.memberId._id.toString();
      const commenterName = comment.memberId.username;
      
      if (!communicationGraph[commenterId]) {
        communicationGraph[commenterId] = {
          memberId: commenterId,
          memberName: commenterName,
          interactions: {}
        };
      }
      
      // Extract mentions
      const mentions = comment.text.match(/@(\w+)/g) || [];
      
      for (const mention of mentions) {
        const mentionedUsername = mention.substring(1);
        const mentionedMember = await Member.findOne({ username: mentionedUsername, workspaceId });
        
        if (mentionedMember && mentionedMember._id.toString() !== commenterId) {
          const mentionedId = mentionedMember._id.toString();
          
          if (!communicationGraph[commenterId].interactions[mentionedId]) {
            communicationGraph[commenterId].interactions[mentionedId] = {
              memberId: mentionedId,
              memberName: mentionedMember.username,
              count: 0
            };
          }
          
          communicationGraph[commenterId].interactions[mentionedId].count++;
        }
      }
    }
    
    // Convert to array format
    for (const memberId in communicationGraph) {
      const interactions = [];
      for (const targetId in communicationGraph[memberId].interactions) {
        interactions.push(communicationGraph[memberId].interactions[targetId]);
      }
      interactions.sort((a, b) => b.count - a.count);
      communicationGraph[memberId].interactions = interactions;
    }
    
    return Object.values(communicationGraph);
  } catch (error) {
    logger.error('Failed to analyze communication patterns:', error);
    return [];
  }
};

// Analyze member language patterns
const analyzeMemberLanguagePatterns = async (memberId, options = {}) => {
  try {
    logger.info(`Analyzing language patterns for member: ${memberId}`);
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId || getDefaultWorkspaceObjectId());
    
    // Get all comments by this member
    const comments = await Comment.find({ memberId, workspaceId });
    
    if (comments.length === 0) {
      return null;
    }
    
    // Combine all comment texts
    const commentTexts = comments.map(c => c.text || '');
    const fullText = commentTexts.join(' ');
    
    // Analyze vocabulary
    const tokens = tokenizer.tokenize(fullText.toLowerCase());
    
    // Remove stop words
    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
      'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'as', 'of'
    ]);
    
    const filteredTokens = tokens.filter(token => 
      !stopWords.has(token) && token.length > 2
    );
    
    // Count word frequency
    const wordCounts = {};
    for (const token of filteredTokens) {
      wordCounts[token] = (wordCounts[token] || 0) + 1;
    }
    
    // Get frequent words
    const frequentWords = Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));
    
    // Analyze sentiment patterns
    let totalSentiment = 0;
    for (const text of commentTexts) {
      if (text) {
        const tokens = tokenizer.tokenize(text);
        totalSentiment += analyzer.getSentiment(tokens);
      }
    }
    
    const averageSentiment = commentTexts.length > 0 ? 
      totalSentiment / commentTexts.length : 0;
    
    // Analyze communication style
    const avgCommentLength = commentTexts.reduce((sum, text) => 
      sum + text.length, 0) / commentTexts.length;
    
    const usesQuestions = commentTexts.some(text => text.includes('?'));
    const usesMentions = commentTexts.some(text => text.includes('@'));
    
    // Update member's communication style
    const member = await Member.findOne({ _id: memberId, workspaceId });
    if (member) {
      member.communicationStyle = {
        formality: calculateFormality(fullText),
        averageCommentLength: avgCommentLength,
        sentimentAverage: averageSentiment
      };
      await member.save();
    }
    
    return {
      memberId,
      commentCount: comments.length,
      frequentWords,
      averageSentiment,
      communicationStyle: {
        averageCommentLength: avgCommentLength,
        usesQuestions,
        usesMentions
      }
    };
  } catch (error) {
    logger.error(`Failed to analyze language patterns for member ${memberId}:`, error);
    return null;
  }
};

// Calculate text formality
const calculateFormality = (text) => {
  const formalIndicators = [
    'please', 'thank you', 'would', 'could', 'should',
    'therefore', 'however', 'furthermore'
  ];
  
  const informalIndicators = [
    'hey', 'hi', 'yeah', 'cool', 'awesome', 'ok', 'okay',
    'btw', 'lol', 'thanks', 'thx'
  ];
  
  const textLower = text.toLowerCase();
  
  let formalCount = 0;
  for (const indicator of formalIndicators) {
    if (textLower.includes(indicator)) formalCount++;
  }
  
  let informalCount = 0;
  for (const indicator of informalIndicators) {
    if (textLower.includes(indicator)) informalCount++;
  }
  
  const totalIndicators = formalCount + informalCount;
  if (totalIndicators === 0) return 'casual';
  
  const formalityScore = (formalCount - informalCount) / totalIndicators;
  
  if (formalityScore > 0.5) return 'very_formal';
  if (formalityScore > 0) return 'formal';
  if (formalityScore > -0.5) return 'casual';
  return 'very_casual';
};

module.exports = {
  analyzeCardContent,
  analyzeCommunicationPatterns,
  analyzeMemberLanguagePatterns,
  extractKeywords,
  analyzeSentiment,
  extractEntities,
  detectActionItem
};
