const mongoose = require('mongoose');
const logger = require('./logger');

// MongoDB connection options
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

// Connect to MongoDB
const connectDatabase = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sneup';
    
    logger.info('Connecting to MongoDB...');
    
    await mongoose.connect(mongoUri, options);
    
    logger.info('MongoDB connected successfully');
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });
    
    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });
    
    return mongoose.connection;
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error);
    throw error;
  }
};

// Disconnect from MongoDB
const disconnectDatabase = async () => {
  try {
    if (mongoose.connection.readyState === 0) return;
    await mongoose.connection.close();
    logger.info('MongoDB disconnected');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB:', error);
    throw error;
  }
};

// Check if database is connected
const isDatabaseConnected = () => {
  return mongoose.connection.readyState === 1;
};

// Get database connection status
const getDatabaseStatus = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  
  return {
    state: states[mongoose.connection.readyState] || 'unknown',
    host: mongoose.connection.host,
    port: mongoose.connection.port,
    name: mongoose.connection.name
  };
};

module.exports = {
  connectDatabase,
  disconnectDatabase,
  isDatabaseConnected,
  getDatabaseStatus
};
