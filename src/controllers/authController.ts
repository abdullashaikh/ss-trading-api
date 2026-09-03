import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { callProcedure } from '../config/db.js';
import { generateToken, AuthenticatedRequest } from '../middlewares/auth.js';

export async function login(req: Request, res: Response) {
  try {
    const { loginName, password } = req.body;
    if (!loginName || !password) {
      return res.status(400).json({ success: false, message: 'Login name and password are required' });
    }

    const results = await callProcedure('spDataFlowGetUserByLogin', [loginName]);
    const users = results[0] as any[];

    if (!users || users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken({
      userId: user.user_id,
      loginName: user.login_name,
      userName: user.user_name,
      role: user.role
    });

    return res.json({
      success: true,
      token,
      user: {
        userId: user.user_id,
        loginName: user.login_name,
        userName: user.user_name,
        role: user.role
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Login failed' });
  }
}

export async function getCurrentUser(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const results = await callProcedure('spDataFlowGetUserById', [userId]);
    const user = (results[0] as any[])[0];

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({ success: true, user });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
