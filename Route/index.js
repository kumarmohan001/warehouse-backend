import express from 'express';
const routes = express.Router();
import auth from './auth.js'
import user from './user.js'
import home from './home.js'
import dashboard from './dashboard.js'

routes.use('/home',home)

routes.use('/auth',auth)
routes.use('/user',user)
routes.use('/dashboard',dashboard)

export default routes;
