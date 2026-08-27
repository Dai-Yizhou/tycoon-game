import { MongoClient } from 'mongodb';
import type { UserAccount } from '@game/shared';
import { MongoUserStore } from '../../src/storage/MongoUserStore';

const mockUpdateOne = jest.fn().mockResolvedValue({});
const mockFindOne = jest.fn().mockResolvedValue(null);
const mockDeleteOne = jest.fn().mockResolvedValue({});
const mockCreateIndex = jest.fn().mockResolvedValue('idx');
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockConnect = jest.fn().mockResolvedValue(undefined);

const mockClient = {
  connect: mockConnect,
  close: mockClose,
  db: jest.fn().mockReturnValue({
    collection: jest.fn().mockReturnValue({
      createIndex: mockCreateIndex,
      updateOne: mockUpdateOne,
      findOne: mockFindOne,
      deleteOne: mockDeleteOne,
    }),
  }),
};

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => mockClient),
}));

function buildUser(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    id: 'user-1',
    username: 'alice',
    passwordHash: 'hash',
    isGuest: false,
    createdAt: 100,
    lastLoginAt: 200,
    ...overrides,
  };
}

describe('MongoUserStore', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upserts users and creates unique username indexes', async () => {
    const store = new MongoUserStore('mongodb://localhost:27017');

    await store.saveUser(buildUser());

    expect(mockCreateIndex).toHaveBeenCalledWith({ username: 1 }, { unique: true });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'user-1' },
      { $set: expect.objectContaining({ _id: 'user-1', username: 'alice' }) },
      { upsert: true },
    );
  });

  it('loads users by id and username', async () => {
    const store = new MongoUserStore('mongodb://localhost:27017');
    const document = {
      _id: 'user-1',
      username: 'alice',
      passwordHash: 'hash',
      isGuest: false,
      createdAt: 100,
      lastLoginAt: 200,
    };
    mockFindOne.mockResolvedValue(document);

    await expect(store.loadUserById('user-1')).resolves.toEqual(buildUser());
    await expect(store.loadUserByUsername('alice')).resolves.toEqual(buildUser());
    expect(mockFindOne).toHaveBeenNthCalledWith(1, { _id: 'user-1' });
    expect(mockFindOne).toHaveBeenNthCalledWith(2, { username: 'alice' });
  });

  it('deletes users and closes the database client', async () => {
    const store = new MongoUserStore('mongodb://localhost:27017');

    await store.deleteUser('user-1');
    await store.close();

    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'user-1' });
    expect(mockClose).toHaveBeenCalled();
  });
});
